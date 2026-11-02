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

func ortLibPath() string {
	if p := os.Getenv("PA_ORT_LIB"); p != "" {
		return p
	}
	return filepath.Join(aiDir(), ortLibName())
}

func modelPath() string { return filepath.Join(aiDir(), modelFile) }

func exists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.Size() > 0
}

func aiReady() bool { return exists(ortLibPath()) && exists(modelPath()) }

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

func runSetup() {
	fail := func(err error) {
		setup.Lock()
		setup.err = err.Error()
		setup.running = false
		setup.Unlock()
	}
	if !exists(ortLibPath()) {
		setup.Lock()
		setup.stage = "движок нейросети"
		setup.Unlock()
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
		st := map[string]any{"ok": true, "ready": aiReady(), "running": setup.running, "stage": setup.stage,
			"done": setup.done, "total": setup.total, "error": setup.err, "sizeMB": 250}
		setup.Unlock()
		reply(c, 200, st)
	case method == "POST" && path == "/ai/setup":
		if headers["x-premiere-assistant"] != "1" {
			reply(c, 403, map[string]any{"ok": false, "error": "forbidden"})
			return true
		}
		setup.Lock()
		if !setup.running && !aiReady() {
			setup.running, setup.done, setup.total, setup.err, setup.stage = true, 0, 0, "", "начинаю"
			go runSetup()
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
			In  string `json:"in"`
			Out string `json:"out"`
		}
		if json.Unmarshal(b, &req) != nil || req.In == "" || req.Out == "" {
			reply(c, 400, map[string]any{"ok": false, "error": "нужны in и out"})
			return true
		}
		if !imageExt[strings.ToLower(filepath.Ext(req.In))] {
			reply(c, 400, map[string]any{"ok": false, "error": "Пока поддерживаются картинки PNG и JPG."})
			return true
		}
		if strings.ToLower(filepath.Ext(req.Out)) != ".png" || !exists(req.In) {
			reply(c, 400, map[string]any{"ok": false, "error": "файл не найден или неверный путь результата"})
			return true
		}
		if !aiReady() {
			reply(c, 409, map[string]any{"ok": false, "error": "нейросеть ещё не скачана", "needSetup": true})
			return true
		}
		id, j := newJob()
		go func() {
			err := removeBackground(req.In, req.Out, func(p float64) { setJob(j, func(j *job) { j.Progress = p }) })
			setJob(j, func(j *job) {
				if err != nil {
					j.State, j.Error = "error", err.Error()
				} else {
					j.State, j.Progress, j.Out = "done", 1, req.Out
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
		reply(c, 200, map[string]any{"ok": true, "state": cp.State, "progress": cp.Progress, "out": cp.Out, "error": cp.Error})
	default:
		return false
	}
	return true
}
