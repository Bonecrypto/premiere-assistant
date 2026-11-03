// Удаление фона с видео: ffmpeg разбирает кадры (rgb24) → ISNet → маска (сглаживание между кадрами) →
// ffmpeg собирает ProRes 4444 с прозрачностью (.mov). Обрабатывается только кусок клипа, который лежит на таймлайне.
package main

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
)

var videoExt = map[string]bool{".mp4": true, ".mov": true, ".m4v": true, ".mkv": true, ".avi": true, ".mxf": true, ".webm": true, ".mts": true}

func ffmpegPath() string {
	name := "ffmpeg"
	if runtime.GOOS == "windows" {
		name = "ffmpeg.exe"
	}
	if p := filepath.Join(aiDir(), name); exists(p) {
		return p
	}
	if p, err := exec.LookPath("ffmpeg"); err == nil {
		return p
	}
	return ""
}

type videoInfo struct {
	W, H     int
	FPS      float64
	Duration float64
}

var (
	reStream   = regexp.MustCompile(`Stream #\S+.*Video: .*?(\d{2,5})x(\d{2,5})`)
	reFPS      = regexp.MustCompile(`(\d+(?:\.\d+)?) (?:fps|tbr)`)
	reDuration = regexp.MustCompile(`Duration: (\d+):(\d+):(\d+(?:\.\d+)?)`)
	reRotate   = regexp.MustCompile(`(?i)rotat(?:e|ion)\D{0,20}(-?\d+)`)
)

// parseProbe разбирает вывод `ffmpeg -i файл` (stderr).
func parseProbe(s string) (videoInfo, error) {
	var v videoInfo
	var line string
	for _, l := range strings.Split(s, "\n") {
		if strings.Contains(l, "Video:") {
			line = l
			break
		}
	}
	m := reStream.FindStringSubmatch(line)
	if m == nil {
		return v, errors.New("в файле нет видео")
	}
	v.W, _ = strconv.Atoi(m[1])
	v.H, _ = strconv.Atoi(m[2])
	if f := reFPS.FindStringSubmatch(line); f != nil {
		v.FPS, _ = strconv.ParseFloat(f[1], 64)
	}
	if v.FPS <= 0 {
		v.FPS = 25
	}
	if d := reDuration.FindStringSubmatch(s); d != nil {
		hh, _ := strconv.ParseFloat(d[1], 64)
		mm, _ := strconv.ParseFloat(d[2], 64)
		ss, _ := strconv.ParseFloat(d[3], 64)
		v.Duration = hh*3600 + mm*60 + ss
	}
	// Повёрнутое видео с телефона: ffmpeg отдаёт кадры уже повёрнутыми — меняем местами стороны.
	if r := reRotate.FindStringSubmatch(s); r != nil {
		if a, _ := strconv.Atoi(r[1]); a == 90 || a == -90 || a == 270 || a == -270 {
			v.W, v.H = v.H, v.W
		}
	}
	return v, nil
}

func probe(ff, in string) (videoInfo, error) {
	cmd := exec.Command(ff, "-hide_banner", "-i", in)
	hideWindow(cmd)
	out, _ := cmd.CombinedOutput() // без выходного файла ffmpeg всегда «падает» — нам нужен только вывод
	return parseProbe(string(out))
}

func fmtSec(s float64) string { return strconv.FormatFloat(s, 'f', 3, 64) }

// removeBackgroundVideo — кусок [ss, ss+dur] файла in → out (.mov, ProRes 4444 с альфой).
func removeBackgroundVideo(in, out string, ss, dur float64, progress func(float64)) error {
	ff := ffmpegPath()
	if ff == "" {
		return errors.New("нет ffmpeg")
	}
	info, err := probe(ff, in)
	if err != nil {
		return err
	}
	if dur <= 0 {
		dur = info.Duration - ss
	}
	if dur <= 0 {
		return errors.New("пустой кусок видео")
	}
	// Очень большие кадры (4K+) уменьшаем до 1920 по длинной стороне — маске это не вредит, а скорость в разы выше.
	w, h := info.W, info.H
	scale := ""
	if max(w, h) > 1920 {
		k := 1920.0 / float64(max(w, h))
		w, h = int(float64(w)*k)/2*2, int(float64(h)*k)/2*2
		scale = fmt.Sprintf("scale=%d:%d", w, h)
	}
	total := int(dur*info.FPS + 0.5)
	if total < 1 {
		total = 1
	}

	decArgs := []string{"-v", "error", "-ss", fmtSec(ss), "-t", fmtSec(dur), "-i", in, "-an"}
	if scale != "" {
		decArgs = append(decArgs, "-vf", scale)
	}
	decArgs = append(decArgs, "-f", "rawvideo", "-pix_fmt", "rgb24", "-")
	dec := exec.Command(ff, decArgs...)
	hideWindow(dec)
	decOut, err := dec.StdoutPipe()
	if err != nil {
		return err
	}
	var decErr strings.Builder
	dec.Stderr = &decErr

	tmp := strings.TrimSuffix(out, filepath.Ext(out)) + ".part.mov"
	enc := exec.Command(ff, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", fmt.Sprintf("%dx%d", w, h),
		"-r", strconv.FormatFloat(info.FPS, 'f', -1, 64), "-i", "-",
		"-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-vendor", "apl0", "-an", tmp)
	hideWindow(enc)
	encIn, err := enc.StdinPipe()
	if err != nil {
		return err
	}
	var encErr strings.Builder
	enc.Stderr = &encErr

	if err := dec.Start(); err != nil {
		return fmt.Errorf("ffmpeg не запустился: %w", err)
	}
	if err := enc.Start(); err != nil {
		dec.Process.Kill()
		return fmt.Errorf("ffmpeg не запустился: %w", err)
	}
	fail := func(e error) error {
		encIn.Close()
		dec.Process.Kill()
		enc.Process.Kill()
		dec.Wait()
		enc.Wait()
		os.Remove(tmp)
		return e
	}

	model.Lock()
	defer model.Unlock()
	if err := loadModel(); err != nil {
		return fail(err)
	}
	r := bufio.NewReaderSize(decOut, w*h*3)
	rgb := make([]byte, w*h*3)
	rgba := make([]byte, w*h*4)
	var prev []float32
	done := 0
	for {
		if _, err := io.ReadFull(r, rgb); err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				break
			}
			return fail(err)
		}
		mask, err := inferMask(rgb, w, h)
		if err != nil {
			return fail(err)
		}
		// Сглаживание между кадрами — меньше «дрожания» края.
		if prev != nil {
			for i := range mask {
				mask[i] = 0.75*mask[i] + 0.25*prev[i]
			}
		}
		prev = mask
		composeRGBA(rgb, nil, w, h, mask, rgba)
		if _, err := encIn.Write(rgba); err != nil {
			return fail(fmt.Errorf("ffmpeg (сборка) остановился: %v %s", err, encErr.String()))
		}
		done++
		progress(min(0.99, float64(done)/float64(total)))
	}
	encIn.Close()
	if err := dec.Wait(); err != nil && done == 0 {
		return fail(fmt.Errorf("ffmpeg не прочитал видео: %s", strings.TrimSpace(decErr.String())))
	}
	if err := enc.Wait(); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("ffmpeg не собрал видео: %s", strings.TrimSpace(encErr.String()))
	}
	if done == 0 {
		os.Remove(tmp)
		return errors.New("в этом куске нет кадров")
	}
	os.Remove(out)
	return os.Rename(tmp, out)
}
