package main

import (
	"os/exec"
	"path/filepath"
	"testing"
)

// Два «микрофона»: первый звучит 0–1 с, второй 1–2 с.
func TestMeasureLevels(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("нужен ffmpeg")
	}
	dir := t.TempDir()
	mk := func(name, expr string) string {
		p := filepath.Join(dir, name)
		if b, err := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "aevalsrc=exprs='"+expr+"':d=2:s=48000", p).CombinedOutput(); err != nil {
			t.Fatal(err, string(b))
		}
		return p
	}
	a := mk("a.wav", "0.5*sin(2*PI*300*t)*lt(t,1)")
	b := mk("b.wav", "0.5*sin(2*PI*300*t)*gte(t,1)")
	res, err := measureLevels(levelsReq{Inputs: []levelsInput{{In: a}, {In: b}}, Win: 0.1}, func(float64) {})
	if err != nil {
		t.Fatal(err)
	}
	l := res["levels"].([][]float64)
	if len(l) != 2 || len(l[0]) != 20 || l[0][3] < -15 || l[0][15] > -60 || l[1][3] > -60 || l[1][15] < -15 {
		t.Fatalf("%v", l)
	}
}
