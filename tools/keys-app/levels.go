// Громкость по времени для нескольких записей (микрофоны подкаста): RMS в дБ на каждое окно (по умолчанию 0.1 с).
package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"os/exec"
)

type levelsInput struct {
	In  string  `json:"in"`
	SS  float64 `json:"ss"`
	Dur float64 `json:"dur"`
}

type levelsReq struct {
	Inputs []levelsInput `json:"inputs"`
	Win    float64       `json:"win"`
}

const levelsSR = 8000

// rmsDB — громкость окон (дБ, тишина ≈ −90).
func rmsDB(x []float64, win int) []float64 {
	out := make([]float64, 0, len(x)/win+1)
	for i := 0; i+win <= len(x); i += win {
		s := 0.0
		for _, v := range x[i : i+win] {
			s += v * v
		}
		out = append(out, math.Max(-90, 10*math.Log10(s/float64(win)+1e-12)))
	}
	return out
}

func readMono(ff string, in levelsInput, sr int) ([]float64, error) {
	args := []string{"-v", "error"}
	if in.SS > 0 {
		args = append(args, "-ss", fmtSec(in.SS))
	}
	if in.Dur > 0 {
		args = append(args, "-t", fmtSec(in.Dur))
	}
	args = append(args, "-i", in.In, "-vn", "-ac", "1", "-ar", fmt.Sprint(sr), "-f", "s16le", "-")
	cmd := exec.Command(ff, args...)
	hideWindow(cmd)
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("ffmpeg не запустился: %w", err)
	}
	raw, err := io.ReadAll(out)
	cmd.Wait()
	if err != nil {
		return nil, err
	}
	x := make([]float64, len(raw)/2)
	for i := range x {
		x[i] = float64(int16(binary.LittleEndian.Uint16(raw[i*2:]))) / 32768
	}
	return x, nil
}

func measureLevels(req levelsReq, progress func(float64)) (map[string]any, error) {
	ff := ffmpegPath()
	if ff == "" {
		return nil, errors.New("нет ffmpeg")
	}
	if len(req.Inputs) == 0 || len(req.Inputs) > 8 {
		return nil, errors.New("нужно от 1 до 8 записей")
	}
	win := req.Win
	if win <= 0.02 || win > 1 {
		win = 0.1
	}
	n := int(win * levelsSR)
	var all [][]float64
	for i, in := range req.Inputs {
		if !exists(in.In) {
			return nil, fmt.Errorf("нет файла: %s", in.In)
		}
		x, err := readMono(ff, in, levelsSR)
		if err != nil {
			return nil, err
		}
		all = append(all, rmsDB(x, n))
		progress(float64(i+1) / float64(len(req.Inputs)))
	}
	return map[string]any{"levels": all, "win": win}, nil
}
