package main

import (
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestParseSilence(t *testing.T) {
	out := "[silencedetect @ 0x1] silence_start: 1.2\n[silencedetect @ 0x1] silence_end: 2.5 | silence_duration: 1.3\n[silencedetect @ 0x1] silence_start: 7.9\n"
	r := parseSilence(out, 9)
	if len(r) != 2 || r[0] != (interval{1.2, 2.5}) || r[1] != (interval{7.9, 9}) {
		t.Fatalf("%+v", r)
	}
}

// Настоящая проверка с ffmpeg: тон 1 с — тишина 1 с — тон 1 с — тишина 0.3 с — тон 1 с; ищем с 0.5 с, длина 4 с.
func TestDetectSilenceReal(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil || os.Getenv("PA_AI_TEST") != "1" {
		t.Skip("нужен ffmpeg и PA_AI_TEST=1")
	}
	in := filepath.Join(t.TempDir(), "a.wav")
	expr := "if(lt(t,1)+between(t,2,3)+between(t,3.3,4.3),0.5*sin(2*PI*440*t),0)"
	if b, err := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "aevalsrc=exprs='"+expr+"':d=4.3:s=48000", in).CombinedOutput(); err != nil {
		t.Fatal(err, string(b))
	}
	r, err := detectSilence(silenceReq{In: in, SS: 0.5, Dur: 3.8, Noise: -40, Min: 0.5}, func(float64) {})
	if err != nil {
		t.Fatal(err)
	}
	// Ожидаем одну паузу ≈ [0.5, 1.5] (в исходнике 1…2 с, кусок начинается с 0.5); 0.3 с — короче порога.
	if len(r) != 1 || math.Abs(r[0].Start-0.5) > 0.05 || math.Abs(r[0].End-1.5) > 0.05 {
		t.Fatalf("%+v", r)
	}
}
