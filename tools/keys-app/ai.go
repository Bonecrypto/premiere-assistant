// Нейросети (удаление фона): загрузка движка ONNX Runtime и модели, задания с прогрессом.
// Всё работает локально; скачивается один раз в %LOCALAPPDATA%\PremiereAssistant\ai.
package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const ortVersion = "1.24.1"

// Модель ISNet (DIS, лицензия Apache-2.0) — общая: люди, предметы, логотипы.
const modelURL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx"
const modelFile = "isnet-general-use.onnx"

func aiDir() string {
	if d := os.Getenv("PA_AI_DIR"); d != "" {
		return d
	}
	base, err := os.UserCacheDir() // Windows: %LOCALAPPDATA%
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "PremiereAssistant", "ai")
}

func ortLibName() string {
	if runtime.GOOS == "windows" {
		return "onnxruntime.dll"
	}
	return "libonnxruntime.so"
}

// Сборка ONNX Runtime с DirectML (видеокарта) лежит отдельно: ai/dml/onnxruntime.dll + DirectML.dll.
func dmlDir() string { return filepath.Join(aiDir(), "dml") }

func usingDML() bool {
	return runtime.GOOS == "windows" && exists(filepath.Join(dmlDir(), "onnxruntime.dll")) && exists(filepath.Join(dmlDir(), "DirectML.dll"))
}

func ortLibPath() string {
	if p := os.Getenv("PA_ORT_LIB"); p != "" {
		return p
	}
	if usingDML() {
		return filepath.Join(dmlDir(), "onnxruntime.dll")
	}
	return filepath.Join(aiDir(), ortLibName())
}

const (
	ortDMLURL = "https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime.directml/" + ortVersion + "/microsoft.ml.onnxruntime.directml." + ortVersion + ".nupkg"
	dmlURL    = "https://api.nuget.org/v3-flatcontainer/microsoft.ai.directml/1.15.4/microsoft.ai.directml.1.15.4.nupkg"
	ffmpegURL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
)

func modelPath() string { return filepath.Join(aiDir(), modelFile) }

func exists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.Size() > 0
}

func aiReady() bool { return exists(ortLibPath()) && exists(modelPath()) }

// На Windows — только сборка с видеокартой (старую CPU-сборку v8 заменяем при следующей настройке).
func aiFullyReady() bool {
	return aiReady() && (runtime.GOOS != "windows" || usingDML() || os.Getenv("PA_ORT_LIB") != "")
}

// ── Загрузка ──

var setup struct {
	sync.Mutex
	running bool
	done    int64
	total   int64
	stage   string
	err     string
}

type counter struct {
	w io.Writer
	n *int64
}

func (c counter) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	setup.Lock()
	*c.n += int64(n)
	setup.Unlock()
	return n, err
}

func download(url string, sizeHint int64) ([]byte, error) {
	client := &http.Client{Timeout: 30 * time.Minute}
	res, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("сервер ответил %d", res.StatusCode)
	}
	total := res.ContentLength
	if total <= 0 {
		total = sizeHint
	}
	setup.Lock()
	setup.total += total
	setup.Unlock()
	var buf bytes.Buffer
	if _, err := io.Copy(counter{&buf, &setup.done}, res.Body); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func writeAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".part"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// extractRuntime достаёт из архива ONNX Runtime нужную библиотеку.
func extractRuntime(archive []byte) ([]byte, error) {
	want := ortLibName()
	if runtime.GOOS == "windows" {
		zr, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
		if err != nil {
			return nil, err
		}
		for _, f := range zr.File {
			if strings.HasSuffix(f.Name, "/lib/"+want) {
				rc, err := f.Open()
				if err != nil {
					return nil, err
				}
				defer rc.Close()
				return io.ReadAll(rc)
			}
		}
		return nil, errors.New("в архиве нет " + want)
	}
	gz, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		return nil, err
	}
	tr := tar.NewReader(gz)
	for {
		h, err := tr.Next()
		if err != nil {
			return nil, errors.New("в архиве нет " + want)
		}
		if strings.Contains(h.Name, "/lib/"+want+"."+ortVersion) {
			return io.ReadAll(tr)
		}
	}
}

func runtimeURL() string {
	if runtime.GOOS == "windows" {
		return fmt.Sprintf("https://github.com/microsoft/onnxruntime/releases/download/v%s/onnxruntime-win-x64-%s.zip", ortVersion, ortVersion)
	}
	return fmt.Sprintf("https://github.com/microsoft/onnxruntime/releases/download/v%s/onnxruntime-linux-x64-%s.tgz", ortVersion, ortVersion)
}

func runSetup(video bool) {
	fail := func(err error) {
		setup.Lock()
		setup.err = err.Error()
		setup.running = false
		setup.Unlock()
	}
	stage := func(t string) {
		setup.Lock()
		setup.stage = t
		setup.Unlock()
	}
	if runtime.GOOS == "windows" && os.Getenv("PA_ORT_LIB") == "" {
		// Windows: сборка с DirectML — работает и на видеокарте (любой: NVIDIA, AMD, Intel), и на процессоре.
		if !usingDML() {
			stage("движок нейросети (видеокарта)")
			lib, err := fetchZipEntry(ortDMLURL, "runtimes/win-x64/native/onnxruntime.dll", 13<<20)
			if err != nil {
				fail(fmt.Errorf("не скачался движок: %w", err))
				return
			}
			dml, err := fetchZipEntry(dmlURL, "bin/x64-win/DirectML.dll", 200<<20)
			if err != nil {
				fail(fmt.Errorf("не скачалась DirectML: %w", err))
				return
			}
			if err := writeAtomic(filepath.Join(dmlDir(), "DirectML.dll"), dml); err != nil {
				fail(err)
				return
			}
			if err := writeAtomic(filepath.Join(dmlDir(), "onnxruntime.dll"), lib); err != nil {
				fail(err)
				return
			}
		}
	} else if !exists(ortLibPath()) {
		stage("движок нейросети")
		arc, err := download(runtimeURL(), 60<<20)
		if err != nil {
			fail(fmt.Errorf("не скачался движок: %w", err))
			return
		}
		lib, err := extractRuntime(arc)
		if err != nil {
			fail(err)
			return
		}
		if err := writeAtomic(ortLibPath(), lib); err != nil {
			fail(err)
			return
		}
	}
	if video && ffmpegPath() == "" {
		if runtime.GOOS != "windows" {
			fail(errors.New("установите ffmpeg"))
			return
		}
		stage("ffmpeg (видео)")
		exe, err := fetchZipEntry(ffmpegURL, "/bin/ffmpeg.exe", 200<<20)
		if err != nil {
			fail(fmt.Errorf("не скачался ffmpeg: %w", err))
			return
		}
		if err := writeAtomic(filepath.Join(aiDir(), "ffmpeg.exe"), exe); err != nil {
			fail(err)
			return
		}
	}
	if !exists(modelPath()) {
		setup.Lock()
		setup.stage = "модель"
		setup.Unlock()
		m, err := download(modelURL, 180<<20)
		if err != nil {
			fail(fmt.Errorf("не скачалась модель: %w", err))
			return
		}
		if len(m) < 10<<20 {
			fail(errors.New("скачался не тот файл модели"))
			return
		}
		if err := writeAtomic(modelPath(), m); err != nil {
			fail(err)
			return
		}
	}
	setup.Lock()
	setup.running = false
	setup.stage = "готово"
	setup.Unlock()
}

// ── Задания ──

type job struct {
	State    string  `json:"state"` // running | done | error
	Progress float64 `json:"progress"`
	Out      string  `json:"out,omitempty"`
	Error    string  `json:"error,omitempty"`
	GPU      bool    `json:"gpu"`
	Result   any     `json:"result,omitempty"`
}

var jobs = struct {
	sync.Mutex
	m    map[string]*job
	next int
}{m: map[string]*job{}}

func newJob() (string, *job) {
	jobs.Lock()
	defer jobs.Unlock()
	jobs.next++
	id := strconv.Itoa(jobs.next)
	j := &job{State: "running"}
	jobs.m[id] = j
	return id, j
}

func setJob(j *job, f func(j *job)) {
	jobs.Lock()
	f(j)
	jobs.Unlock()
}

var imageExt = map[string]bool{".png": true, ".jpg": true, ".jpeg": true}

// handleAI обрабатывает /ai/* и /removebg. Возвращает false, если путь не наш.
func handleAI(c net.Conn, method, path string, headers map[string]string, body func(max int) ([]byte, bool)) bool {
	switch {
	case method == "GET" && path == "/ai/status":
		setup.Lock()
		st := map[string]any{"ok": true, "ready": aiFullyReady(), "video": aiFullyReady() && ffmpegPath() != "", "ffmpeg": ffmpegPath() != "", "gpu": usingDML(),
			"running": setup.running, "stage": setup.stage, "done": setup.done, "total": setup.total, "error": setup.err,
			"sizeMB": 210, "videoMB": 90}
		setup.Unlock()
		reply(c, 200, st)
	case method == "POST" && (path == "/ai/setup" || path == "/ai/setup?video=1"):
		if headers["x-premiere-assistant"] != "1" {
			reply(c, 403, map[string]any{"ok": false, "error": "forbidden"})
			return true
		}
		video := strings.HasSuffix(path, "video=1")
		setup.Lock()
		if !setup.running && (!aiFullyReady() || (video && ffmpegPath() == "")) {
			setup.running, setup.done, setup.total, setup.err, setup.stage = true, 0, 0, "", "начинаю"
			go runSetup(video)
		}
		setup.Unlock()
		reply(c, 200, map[string]any{"ok": true})
	case method == "POST" && path == "/removebg":
		if headers["x-premiere-assistant"] != "1" {
			reply(c, 403, map[string]any{"ok": false, "error": "forbidden"})
			return true
		}
		b, ok := body(8192)
		if !ok {
			reply(c, 400, map[string]any{"ok": false, "error": "пустой запрос"})
			return true
		}
		var req struct {
			In  string  `json:"in"`
			Out string  `json:"out"`
			SS  float64 `json:"ss"`
			Dur float64 `json:"dur"`
		}
		if json.Unmarshal(b, &req) != nil || req.In == "" || req.Out == "" {
			reply(c, 400, map[string]any{"ok": false, "error": "нужны in и out"})
			return true
		}
		ext := strings.ToLower(filepath.Ext(req.In))
		isVideo := videoExt[ext]
		if !imageExt[ext] && !isVideo {
			reply(c, 400, map[string]any{"ok": false, "error": "Этот формат пока не поддерживается: картинки PNG/JPG и видео MP4/MOV/MKV/AVI/MXF/WEBM."})
			return true
		}
		wantOut := ".png"
		if isVideo {
			wantOut = ".mov"
		}
		if strings.ToLower(filepath.Ext(req.Out)) != wantOut || !exists(req.In) {
			reply(c, 400, map[string]any{"ok": false, "error": "файл не найден или неверный путь результата"})
			return true
		}
		if !aiReady() || (isVideo && ffmpegPath() == "") {
			reply(c, 409, map[string]any{"ok": false, "error": "нейросеть ещё не скачана", "needSetup": true, "video": isVideo})
			return true
		}
		id, j := newJob()
		go func() {
			report := func(p float64) { setJob(j, func(j *job) { j.Progress = p }) }
			var err error
			if isVideo {
				err = removeBackgroundVideo(req.In, req.Out, req.SS, req.Dur, report)
			} else {
				err = removeBackground(req.In, req.Out, report)
			}
			setJob(j, func(j *job) {
				if err != nil {
					j.State, j.Error = "error", err.Error()
				} else {
					j.State, j.Progress, j.Out = "done", 1, req.Out
				}
				j.GPU = model.gpu
			})
		}()
		reply(c, 200, map[string]any{"ok": true, "job": id})
	case method == "POST" && path == "/silence":
		if headers["x-premiere-assistant"] != "1" {
			reply(c, 403, map[string]any{"ok": false, "error": "forbidden"})
			return true
		}
		b, ok := body(8192)
		var req silenceReq
		if !ok || json.Unmarshal(b, &req) != nil || req.In == "" || !exists(req.In) {
			reply(c, 400, map[string]any{"ok": false, "error": "файл не найден"})
			return true
		}
		if ffmpegPath() == "" {
			reply(c, 409, map[string]any{"ok": false, "error": "нужен ffmpeg", "needSetup": true, "video": true})
			return true
		}
		id, j := newJob()
		go func() {
			res, err := detectSilence(req, func(p float64) { setJob(j, func(j *job) { j.Progress = p }) })
			setJob(j, func(j *job) {
				if err != nil {
					j.State, j.Error = "error", err.Error()
				} else {
					j.State, j.Progress, j.Result = "done", 1, res
				}
			})
		}()
		reply(c, 200, map[string]any{"ok": true, "job": id})
	case method == "GET" && strings.HasPrefix(path, "/job/"):
		jobs.Lock()
		j, ok := jobs.m[strings.TrimPrefix(path, "/job/")]
		var cp job
		if ok {
			cp = *j
		}
		jobs.Unlock()
		if !ok {
			reply(c, 404, map[string]any{"ok": false, "error": "нет такого задания"})
			return true
		}
		reply(c, 200, map[string]any{"ok": true, "state": cp.State, "progress": cp.Progress, "out": cp.Out, "error": cp.Error, "gpu": cp.GPU, "result": cp.Result})
	default:
		return false
	}
	return true
}
