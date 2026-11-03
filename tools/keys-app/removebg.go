// Удаление фона: модель ISNet (1024×1024) через ONNX Runtime — на видеокарте (DirectML), иначе на процессоре.
// Предобработка — как в rembg: деление на максимум пикселя, mean 0.5, std 1.0; маска — min-max нормализация.
// Работаем с «сырыми» буферами RGB, чтобы видео 1080p обрабатывалось быстро.
package main

import (
	"errors"
	"fmt"
	"image"
	"image/draw"
	_ "image/jpeg"
	"image/png"
	"math"
	"os"
	"runtime"
	"sync"

	ort "github.com/yalue/onnxruntime_go"
)

const netSize = 1024

var model struct {
	sync.Mutex
	session *ort.DynamicAdvancedSession
	gpu     bool
	input   *ort.Tensor[float32]
}

func loadModel() error {
	if model.session != nil {
		return nil
	}
	if !ort.IsInitialized() {
		prepareDllDir(dmlDir())
		ort.SetSharedLibraryPath(ortLibPath())
		if err := ort.InitializeEnvironment(); err != nil {
			return fmt.Errorf("движок нейросети не запустился (%v). Обычно помогает установить Microsoft Visual C++ Redistributable x64: https://aka.ms/vs/17/release/vc_redist.x64.exe", err)
		}
	}
	ins, outs, err := ort.GetInputOutputInfo(modelPath())
	if err != nil {
		return fmt.Errorf("модель не читается: %w", err)
	}
	if len(ins) == 0 || len(outs) == 0 {
		return errors.New("у модели нет входа/выхода")
	}
	open := func(gpu bool) (*ort.DynamicAdvancedSession, error) {
		opts, err := ort.NewSessionOptions()
		if err != nil {
			return nil, err
		}
		defer opts.Destroy()
		if gpu {
			// DirectML: без «memory pattern» и последовательно — так требует ONNX Runtime.
			_ = opts.SetMemPattern(false)
			_ = opts.SetExecutionMode(ort.ExecutionModeSequential)
			if err := opts.AppendExecutionProviderDirectML(0); err != nil {
				return nil, err
			}
		} else {
			_ = opts.SetIntraOpNumThreads(max(1, runtime.NumCPU()-1))
		}
		return ort.NewDynamicAdvancedSession(modelPath(), []string{ins[0].Name}, []string{outs[0].Name}, opts)
	}
	var s *ort.DynamicAdvancedSession
	gpu := false
	if usingDML() {
		if s, err = open(true); err == nil {
			gpu = true
		}
	}
	if s == nil {
		if s, err = open(false); err != nil {
			return fmt.Errorf("модель не загрузилась: %w", err)
		}
	}
	model.session, model.gpu = s, gpu
	return nil
}

// prepareRGB — тензор 1×3×1024×1024 (NCHW) из RGB-буфера w×h (билинейно).
func prepareRGB(rgb []byte, w, h int, dst []float32) {
	n := netSize * netSize
	mx := 1.0
	for _, v := range rgb {
		if float64(v) > mx {
			mx = float64(v)
		}
	}
	sx := float64(w) / netSize
	sy := float64(h) / netSize
	for y := 0; y < netSize; y++ {
		fy := (float64(y)+0.5)*sy - 0.5
		y0 := int(math.Floor(fy))
		dy := fy - float64(y0)
		y0c, y1c := clamp(y0, h), clamp(y0+1, h)
		for x := 0; x < netSize; x++ {
			fx := (float64(x)+0.5)*sx - 0.5
			x0 := int(math.Floor(fx))
			dx := fx - float64(x0)
			x0c, x1c := clamp(x0, w), clamp(x0+1, w)
			i00, i10, i01, i11 := (y0c*w+x0c)*3, (y0c*w+x1c)*3, (y1c*w+x0c)*3, (y1c*w+x1c)*3
			i := y*netSize + x
			for c := 0; c < 3; c++ {
				v := float64(rgb[i00+c])*(1-dx)*(1-dy) + float64(rgb[i10+c])*dx*(1-dy) + float64(rgb[i01+c])*(1-dx)*dy + float64(rgb[i11+c])*dx*dy
				dst[c*n+i] = float32(v/mx - 0.5)
			}
		}
	}
}

func clamp(v, n int) int {
	if v < 0 {
		return 0
	}
	if v >= n {
		return n - 1
	}
	return v
}

// inferMask — маска 1024×1024 (0…1) для кадра.
func inferMask(rgb []byte, w, h int) ([]float32, error) {
	if err := loadModel(); err != nil {
		return nil, err
	}
	if model.input == nil {
		t, err := ort.NewEmptyTensor[float32](ort.NewShape(1, 3, netSize, netSize))
		if err != nil {
			return nil, err
		}
		model.input = t
	}
	prepareRGB(rgb, w, h, model.input.GetData())
	outs := []ort.Value{nil}
	if err := model.session.Run([]ort.Value{model.input}, outs); err != nil {
		return nil, fmt.Errorf("нейросеть не отработала: %w", err)
	}
	defer outs[0].Destroy()
	t, ok := outs[0].(*ort.Tensor[float32])
	if !ok {
		return nil, errors.New("неожиданный ответ модели")
	}
	raw := t.GetData()
	if len(raw) < netSize*netSize {
		return nil, errors.New("маска неверного размера")
	}
	mask := make([]float32, netSize*netSize)
	lo, hi := float32(math.MaxFloat32), float32(-math.MaxFloat32)
	for _, v := range raw[:netSize*netSize] {
		lo = min(lo, v)
		hi = max(hi, v)
	}
	scale := hi - lo
	if scale < 1e-6 {
		scale = 1
	}
	for i, v := range raw[:netSize*netSize] {
		mask[i] = (v - lo) / scale
	}
	return mask, nil
}

// composeRGBA — кадр w×h с прозрачностью по маске (srcAlpha — исходная прозрачность или nil).
func composeRGBA(rgb, srcAlpha []byte, w, h int, mask []float32, dst []byte) {
	sx := float64(netSize) / float64(w)
	sy := float64(netSize) / float64(h)
	for y := 0; y < h; y++ {
		fy := (float64(y)+0.5)*sy - 0.5
		y0 := int(math.Floor(fy))
		dy := fy - float64(y0)
		y0c, y1c := clamp(y0, netSize), clamp(y0+1, netSize)
		for x := 0; x < w; x++ {
			fx := (float64(x)+0.5)*sx - 0.5
			x0 := int(math.Floor(fx))
			dx := fx - float64(x0)
			x0c, x1c := clamp(x0, netSize), clamp(x0+1, netSize)
			m := float64(mask[y0c*netSize+x0c])*(1-dx)*(1-dy) + float64(mask[y0c*netSize+x1c])*dx*(1-dy) +
				float64(mask[y1c*netSize+x0c])*(1-dx)*dy + float64(mask[y1c*netSize+x1c])*dx*dy
			p := y*w + x
			a := 255.0
			if srcAlpha != nil {
				a = float64(srcAlpha[p])
			}
			dst[p*4], dst[p*4+1], dst[p*4+2] = rgb[p*3], rgb[p*3+1], rgb[p*3+2]
			dst[p*4+3] = uint8(math.Round(math.Min(255, math.Max(0, m*a))))
		}
	}
}

func removeBackground(inPath, outPath string, progress func(float64)) error {
	f, err := os.Open(inPath)
	if err != nil {
		return err
	}
	img, _, err := image.Decode(f)
	f.Close()
	if err != nil {
		return fmt.Errorf("не удалось прочитать картинку: %w", err)
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	nrgba := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.Draw(nrgba, nrgba.Bounds(), img, b.Min, draw.Src)
	rgb := make([]byte, w*h*3)
	alpha := make([]byte, w*h)
	for i := 0; i < w*h; i++ {
		rgb[i*3], rgb[i*3+1], rgb[i*3+2], alpha[i] = nrgba.Pix[i*4], nrgba.Pix[i*4+1], nrgba.Pix[i*4+2], nrgba.Pix[i*4+3]
	}
	progress(0.1)

	model.Lock()
	defer model.Unlock()
	mask, err := inferMask(rgb, w, h)
	if err != nil {
		return err
	}
	progress(0.8)
	out := image.NewNRGBA(image.Rect(0, 0, w, h))
	composeRGBA(rgb, alpha, w, h, mask, out.Pix)
	progress(0.95)
	tmp := outPath + ".part"
	of, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if err := png.Encode(of, out); err != nil {
		of.Close()
		return err
	}
	of.Close()
	return os.Rename(tmp, outPath)
}
