// Удаление фона с картинки: модель ISNet (1024×1024) через ONNX Runtime.
// Предобработка — как в rembg: деление на максимум пикселя, mean 0.5, std 1.0; маска — min-max нормализация.
package main

import (
	"errors"
	"fmt"
	"image"
	"image/color"
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
	in, out string
}

func loadModel() error {
	if model.session != nil {
		return nil
	}
	if !ort.IsInitialized() {
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
	opts, err := ort.NewSessionOptions()
	if err != nil {
		return err
	}
	defer opts.Destroy()
	_ = opts.SetIntraOpNumThreads(max(1, runtime.NumCPU()-1))
	s, err := ort.NewDynamicAdvancedSession(modelPath(), []string{ins[0].Name}, []string{outs[0].Name}, opts)
	if err != nil {
		return fmt.Errorf("модель не загрузилась: %w", err)
	}
	model.session, model.in, model.out = s, ins[0].Name, outs[0].Name
	return nil
}

// bilinear — значение канала в дробной точке.
func sampleRGB(img image.Image, fx, fy float64) (float64, float64, float64) {
	b := img.Bounds()
	x0 := int(math.Floor(fx))
	y0 := int(math.Floor(fy))
	dx, dy := fx-float64(x0), fy-float64(y0)
	at := func(x, y int) (float64, float64, float64) {
		if x < 0 {
			x = 0
		}
		if y < 0 {
			y = 0
		}
		if x >= b.Dx() {
			x = b.Dx() - 1
		}
		if y >= b.Dy() {
			y = b.Dy() - 1
		}
		r, g, bb, _ := img.At(b.Min.X+x, b.Min.Y+y).RGBA()
		return float64(r >> 8), float64(g >> 8), float64(bb >> 8)
	}
	r00, g00, b00 := at(x0, y0)
	r10, g10, b10 := at(x0+1, y0)
	r01, g01, b01 := at(x0, y0+1)
	r11, g11, b11 := at(x0+1, y0+1)
	l := func(a, b, c, d float64) float64 {
		return a*(1-dx)*(1-dy) + b*dx*(1-dy) + c*(1-dx)*dy + d*dx*dy
	}
	return l(r00, r10, r01, r11), l(g00, g10, g01, g11), l(b00, b10, b01, b11)
}

// prepare — тензор 1×3×1024×1024 (NCHW).
func prepare(img image.Image) []float32 {
	b := img.Bounds()
	w, h := float64(b.Dx()), float64(b.Dy())
	n := netSize * netSize
	data := make([]float32, 3*n)
	mx := 1e-6
	for y := 0; y < netSize; y++ {
		fy := (float64(y)+0.5)*h/netSize - 0.5
		for x := 0; x < netSize; x++ {
			fx := (float64(x)+0.5)*w/netSize - 0.5
			r, g, bb := sampleRGB(img, fx, fy)
			i := y*netSize + x
			data[i], data[n+i], data[2*n+i] = float32(r), float32(g), float32(bb)
			mx = math.Max(mx, math.Max(r, math.Max(g, bb)))
		}
	}
	for i := range data {
		data[i] = float32(float64(data[i])/mx - 0.5)
	}
	return data
}

// maskAt — значение маски (0…1) для пикселя исходника.
func maskAt(mask []float32, x, y, w, h int) float64 {
	fx := (float64(x)+0.5)*netSize/float64(w) - 0.5
	fy := (float64(y)+0.5)*netSize/float64(h) - 0.5
	x0 := int(math.Floor(fx))
	y0 := int(math.Floor(fy))
	dx, dy := fx-float64(x0), fy-float64(y0)
	at := func(x, y int) float64 {
		x = min(max(x, 0), netSize-1)
		y = min(max(y, 0), netSize-1)
		return float64(mask[y*netSize+x])
	}
	return at(x0, y0)*(1-dx)*(1-dy) + at(x0+1, y0)*dx*(1-dy) + at(x0, y0+1)*(1-dx)*dy + at(x0+1, y0+1)*dx*dy
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
	progress(0.05)

	model.Lock()
	defer model.Unlock()
	if err := loadModel(); err != nil {
		return err
	}
	progress(0.15)
	input, err := ort.NewTensor(ort.NewShape(1, 3, netSize, netSize), prepare(img))
	if err != nil {
		return err
	}
	defer input.Destroy()
	progress(0.3)
	outs := []ort.Value{nil}
	if err := model.session.Run([]ort.Value{input}, outs); err != nil {
		return fmt.Errorf("нейросеть не отработала: %w", err)
	}
	defer outs[0].Destroy()
	t, ok := outs[0].(*ort.Tensor[float32])
	if !ok {
		return errors.New("неожиданный ответ модели")
	}
	raw := t.GetData()
	if len(raw) < netSize*netSize {
		return errors.New("маска неверного размера")
	}
	mask := raw[:netSize*netSize]
	lo, hi := float32(math.MaxFloat32), float32(-math.MaxFloat32)
	for _, v := range mask {
		lo = min(lo, v)
		hi = max(hi, v)
	}
	scale := hi - lo
	if scale < 1e-6 {
		scale = 1
	}
	progress(0.8)

	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	norm := make([]float32, len(mask))
	for i, v := range mask {
		norm[i] = (v - lo) / scale
	}
	out := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, bb, a := img.At(b.Min.X+x, b.Min.Y+y).RGBA()
			m := maskAt(norm, x, y, w, h)
			alpha := m * float64(a>>8)
			// исходный цвет без премультипликации
			if a > 0 {
				r, g, bb = r*0xffff/a, g*0xffff/a, bb*0xffff/a
			}
			out.SetNRGBA(x, y, color.NRGBA{uint8(r >> 8), uint8(g >> 8), uint8(bb >> 8), uint8(math.Round(math.Min(255, math.Max(0, alpha))))})
		}
	}
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
