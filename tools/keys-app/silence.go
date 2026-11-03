// Поиск пауз: ffmpeg silencedetect по звуку куска клипа. Времена — от начала куска (ss).
package main

import (
	"bufio"
	"errors"
	"fmt"
	"math"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

type silenceReq struct {
	In    string  `json:"in"`
	SS    float64 `json:"ss"`
	Dur   float64 `json:"dur"`
	Noise float64 `json:"noise"` // порог, дБ (например −38)
	Min   float64 `json:"min"`   // минимальная пауза, с
}

type interval struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

var (
	reSilStart = regexp.MustCompile(`silence_start: (-?[\d.]+)`)
	reSilEnd   = regexp.MustCompile(`silence_end: (-?[\d.]+)`)
	reTime     = regexp.MustCompile(`time=(\d+):(\d+):([\d.]+)`)
)

// parseSilence разбирает вывод silencedetect; незакрытая пауза в конце закрывается длиной куска.
func parseSilence(out string, dur float64) []interval {
	var res []interval
	open := math.NaN()
	for _, l := range strings.Split(out, "\n") {
		if m := reSilStart.FindStringSubmatch(l); m != nil {
			open, _ = strconv.ParseFloat(m[1], 64)
		}
		if m := reSilEnd.FindStringSubmatch(l); m != nil && !math.IsNaN(open) {
			e, _ := strconv.ParseFloat(m[1], 64)
			res = append(res, interval{math.Max(0, open), e})
			open = math.NaN()
		}
	}
	if !math.IsNaN(open) && dur > open {
		res = append(res, interval{math.Max(0, open), dur})
	}
	return res
}

func detectSilence(req silenceReq, progress func(float64)) ([]interval, error) {
	ff := ffmpegPath()
	if ff == "" {
		return nil, errors.New("нет ffmpeg")
	}
	noise := req.Noise
	if noise >= 0 || noise < -90 {
		noise = -38
	}
	minDur := req.Min
	if minDur <= 0 {
		minDur = 0.5
	}
	args := []string{"-hide_banner", "-nostats", "-stats_period", "0.5", "-progress", "pipe:2"}
	if req.SS > 0 {
		args = append(args, "-ss", fmtSec(req.SS))
	}
	if req.Dur > 0 {
		args = append(args, "-t", fmtSec(req.Dur))
	}
	args = append(args, "-i", req.In, "-vn", "-af", fmt.Sprintf("silencedetect=noise=%gdB:d=%g", noise, minDur), "-f", "null", "-")
	cmd := exec.Command(ff, args...)
	hideWindow(cmd)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("ffmpeg не запустился: %w", err)
	}
	var all strings.Builder
	sc := bufio.NewScanner(stderr)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		l := sc.Text()
		all.WriteString(l)
		all.WriteByte('\n')
		if req.Dur > 0 {
			if m := reTime.FindStringSubmatch(l); m != nil {
				h, _ := strconv.ParseFloat(m[1], 64)
				mm, _ := strconv.ParseFloat(m[2], 64)
				s, _ := strconv.ParseFloat(m[3], 64)
				progress(math.Min(0.99, (h*3600+mm*60+s)/req.Dur))
			}
		}
	}
	if err := cmd.Wait(); err != nil {
		if strings.Contains(all.String(), "does not contain any stream") || strings.Contains(all.String(), "Output file #0 does not contain") {
			return nil, errors.New("в файле нет звука")
		}
		return nil, fmt.Errorf("ffmpeg: %s", lastLines(all.String(), 2))
	}
	dur := req.Dur
	return parseSilence(all.String(), dur), nil
}

func lastLines(s string, n int) string {
	ls := strings.Split(strings.TrimSpace(s), "\n")
	if len(ls) > n {
		ls = ls[len(ls)-n:]
	}
	return strings.Join(ls, " ")
}
