package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// Конвейер целиком с подделкой whisper-cli (PA_WHISPER_CLI): ffmpeg → wav → «whisper» → слова.
func TestTranscribePipeline(t *testing.T) {
	if os.Getenv("PA_WHISPER_CLI") == "" || ffmpegPath() == "" {
		t.Skip("PA_WHISPER_CLI + ffmpeg")
	}
	in := filepath.Join(t.TempDir(), "a.wav")
	if b, err := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:d=3", in).CombinedOutput(); err != nil {
		t.Fatal(err, string(b))
	}
	last := 0.0
	res, err := transcribe(transcribeReq{In: in, SS: 0.5, Dur: 2, Lang: "ru"}, func(p float64) { last = p })
	if err != nil {
		t.Fatal(err)
	}
	w := res["words"].([]Word)
	if len(w) != 2 || w[1].Text != "два." || last < 0.4 {
		t.Fatalf("%+v %v", res, last)
	}
}
