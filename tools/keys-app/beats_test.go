package main

import (
	"math"
	"os/exec"
	"path/filepath"
	"testing"
)

// Щелчки 120 BPM (каждые 0.5 с, со сдвигом 0.25 с) + тихий шум → темп ≈120, биты на щелчках.
func TestDetectBeatsClicks(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("нужен ffmpeg")
	}
	in := filepath.Join(t.TempDir(), "c.wav")
	expr := "0.8*sin(2*PI*1500*t)*exp(-80*mod(t-0.25+10,0.5))*gte(t,0.25)+0.02*(random(0)-0.5)"
	if b, err := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "aevalsrc=exprs='"+expr+"':d=12:s=44100", in).CombinedOutput(); err != nil {
		t.Fatal(err, string(b))
	}
	res, err := detectBeats(beatsReq{In: in, SS: 1, Dur: 10}, func(float64) {})
	if err != nil {
		t.Fatal(err)
	}
	bpm := res["bpm"].(float64)
	beats := res["beats"].([]float64)
	if math.Abs(bpm-120) > 4 {
		t.Fatalf("темп %v", bpm)
	}
	// Щелчки в куске: 0.25+0.5k−1 → 0.25, 0.75, … (от начала куска, сдвиг ss=1).
	bad := 0
	for _, b := range beats {
		d := math.Mod(b-0.25+10, 0.5)
		if math.Min(d, 0.5-d) > 0.05 {
			bad++
		}
	}
	t.Logf("bpm %.1f, битов %d, мимо %d, первые %v", bpm, len(beats), bad, beats[:min(6, len(beats))])
	if len(beats) < 16 || bad > 1 {
		t.Fatalf("биты мимо щелчков: %d из %d", bad, len(beats))
	}
}
