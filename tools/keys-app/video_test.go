package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseProbe(t *testing.T) {
	out := `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mp4':
  Duration: 00:01:02.50, start: 0.000000, bitrate: 8000 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 7800 kb/s, 29.97 fps, 29.97 tbr, 30k tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, stereo, fltp, 192 kb/s (default)`
	v, err := parseProbe(out)
	if err != nil || v.W != 1920 || v.H != 1080 || v.FPS != 29.97 || v.Duration != 62.5 {
		t.Fatalf("%+v %v", v, err)
	}
	rot := strings.Replace(out, "(default)\n", "(default)\n      Side data:\n        displaymatrix: rotation of -90.00 degrees\n", 1)
	v, _ = parseProbe(rot)
	if v.W != 1080 || v.H != 1920 {
		t.Fatalf("поворот: %+v", v)
	}
	if _, err := parseProbe("Stream #0:0: Audio: aac"); err == nil {
		t.Fatal("без видео должна быть ошибка")
	}
}

// Настоящая проверка: ролик 2 с из фото с наездом → без фона → ProRes 4444 с альфой.
func TestRemoveBackgroundVideoReal(t *testing.T) {
	img := os.Getenv("PA_AI_IMAGE")
	if os.Getenv("PA_AI_TEST") != "1" || !aiReady() || img == "" || ffmpegPath() == "" {
		t.Skip("PA_AI_TEST=1, PA_AI_IMAGE, ffmpeg")
	}
	dir := t.TempDir()
	in := filepath.Join(dir, "in.mp4")
	mk := exec.Command("ffmpeg", "-v", "error", "-y", "-loop", "1", "-i", img, "-t", "2", "-r", "25",
		"-vf", "scale=640:-2,zoompan=z='1+0.002*on':d=1:s=640x426:fps=25", "-pix_fmt", "yuv420p", in)
	if b, err := mk.CombinedOutput(); err != nil {
		t.Fatal(err, string(b))
	}
	out := filepath.Join(aiDir(), "out.mov")
	last := 0.0
	if err := removeBackgroundVideo(in, out, 0.5, 1, func(p float64) { last = p }); err != nil {
		t.Fatal(err)
	}
	b, _ := exec.Command("ffmpeg", "-hide_banner", "-i", out).CombinedOutput()
	if !strings.Contains(string(b), "yuva444p") || !strings.Contains(string(b), "prores") {
		t.Fatalf("нет альфы/ProRes: %s", b)
	}
	png := filepath.Join(aiDir(), "frame.png")
	exec.Command("ffmpeg", "-v", "error", "-y", "-i", out, "-frames:v", "1", png).Run()
	t.Logf("прогресс %.2f, кадр: %s, info: %s", last, png, strings.TrimSpace(strings.Split(string(b), "Stream")[1]))
}

// Частичная загрузка из nupkg (HTTP Range): только onnxruntime.dll из пакета DirectML.
func TestFetchZipEntryRange(t *testing.T) {
	if os.Getenv("PA_AI_TEST") != "1" {
		t.Skip()
	}
	setup.done, setup.total = 0, 0
	b, err := fetchZipEntry(ortDMLURL, "runtimes/win-x64/native/onnxruntime.dll", 13<<20)
	if err != nil {
		t.Fatal(err)
	}
	if len(b) < 10<<20 || string(b[:2]) != "MZ" {
		t.Fatalf("не тот файл: %d байт", len(b))
	}
	t.Logf("onnxruntime.dll (DirectML): %d МБ, скачано %d МБ", len(b)>>20, setup.done>>20)
}
