package main

import (
	"encoding/json"
	"image"
	"net/http"
	"strings"
	"time"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

// Настоящая проверка с моделью: PA_AI_TEST=1 (скачает ~200 МБ в PA_AI_DIR). В CI не запускается.
func TestRemoveBackgroundReal(t *testing.T) {
	if os.Getenv("PA_AI_TEST") != "1" {
		t.Skip("PA_AI_TEST=1 — проверка с настоящей моделью")
	}
	setup.running = true
	runSetup()
	if setup.err != "" || !aiReady() {
		t.Fatalf("загрузка: %q", setup.err)
	}
	in := os.Getenv("PA_AI_IMAGE")
	if in == "" {
		// Синтетика: оранжевый круг на шумном сине-сером фоне.
		img := image.NewRGBA(image.Rect(0, 0, 640, 400))
		for y := 0; y < 400; y++ {
			for x := 0; x < 640; x++ {
				c := color.RGBA{uint8(60 + (x*7+y*13)%40), uint8(80 + (x*3)%30), uint8(110 + (y*5)%40), 255}
				if (x-320)*(x-320)+(y-200)*(y-200) < 120*120 {
					c = color.RGBA{240, 140, 40, 255}
				}
				img.Set(x, y, c)
			}
		}
		in = filepath.Join(t.TempDir(), "in.png")
		f, _ := os.Create(in)
		png.Encode(f, img)
		f.Close()
	}
	out := filepath.Join(aiDir(), "out.png")
	if err := removeBackground(in, out, func(float64) {}); err != nil {
		t.Fatal(err)
	}
	f, _ := os.Open(out)
	defer f.Close()
	res, err := png.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	_, _, _, aCenter := res.At(res.Bounds().Dx()/2, res.Bounds().Dy()/2).RGBA()
	_, _, _, aCorner := res.At(5, 5).RGBA()
	t.Logf("альфа: центр %d, угол %d → %s", aCenter>>8, aCorner>>8, out)
}

// Весь путь по HTTP, как у панели: /ai/status → /removebg → /job/{id}.
func TestRemoveBackgroundHTTP(t *testing.T) {
	if os.Getenv("PA_AI_TEST") != "1" || !aiReady() {
		t.Skip("PA_AI_TEST=1 и скачанная модель")
	}
	addr := "127.0.0.1:18766"
	if !serve(addr) {
		t.Fatal("порт занят")
	}
	in := os.Getenv("PA_AI_IMAGE")
	out := filepath.Join(t.TempDir(), "res.png")
	get := func(method, path, body string) map[string]any {
		req, _ := http.NewRequest(method, "http://"+addr+path, strings.NewReader(body))
		req.Header.Set("X-Premiere-Assistant", "1")
		req.Header.Set("Content-Type", "application/json")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var m map[string]any
		json.NewDecoder(res.Body).Decode(&m)
		return m
	}
	if st := get("GET", "/ai/status", ""); st["ready"] != true {
		t.Fatalf("status: %v", st)
	}
	b, _ := json.Marshal(map[string]string{"in": in, "out": out})
	start := get("POST", "/removebg", string(b))
	if start["ok"] != true {
		t.Fatalf("start: %v", start)
	}
	for i := 0; i < 120; i++ {
		time.Sleep(250 * time.Millisecond)
		j := get("GET", "/job/"+start["job"].(string), "")
		if j["state"] == "done" {
			if !exists(out) {
				t.Fatal("нет файла")
			}
			return
		}
		if j["state"] == "error" {
			t.Fatalf("job: %v", j)
		}
	}
	t.Fatal("долго")
}
