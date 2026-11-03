// Распознавание речи для субтитров: ffmpeg → wav 16 кГц моно → whisper.cpp (whisper-cli) → слова с временем.
// whisper-cli и его DLL — из официального релиза whisper.cpp (MIT); модель large-v3-turbo q5_0 (MIT, ~570 МБ).
package main

import (
	"archive/zip"
	"bufio"
	"bytes"
	"encoding/json"
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

const (
	whisperZipURL   = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.0/whisper-bin-x64.zip"
	whisperModel    = "ggml-large-v3-turbo-q5_0.bin"
	whisperModelURL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/" + whisperModel
)

func whisperDir() string { return filepath.Join(aiDir(), "whisper") }

func whisperCLI() string {
	if p := os.Getenv("PA_WHISPER_CLI"); p != "" {
		return p
	}
	name := "whisper-cli"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return filepath.Join(whisperDir(), name)
}

func whisperModelPath() string {
	if p := os.Getenv("PA_WHISPER_MODEL"); p != "" {
		return p
	}
	return filepath.Join(aiDir(), whisperModel)
}

func whisperReady() bool { return exists(whisperCLI()) && exists(whisperModelPath()) }

// setupWhisper — программа (только whisper-cli и нужные DLL из zip) и модель.
func setupWhisper(stage func(string)) error {
	if !exists(whisperCLI()) {
		if runtime.GOOS != "windows" {
			return errors.New("укажите PA_WHISPER_CLI")
		}
		stage("распознавание речи (whisper.cpp)")
		arc, err := download(whisperZipURL, 5<<20)
		if err != nil {
			return fmt.Errorf("не скачался whisper.cpp: %w", err)
		}
		zr, err := zip.NewReader(bytes.NewReader(arc), int64(len(arc)))
		if err != nil {
			return err
		}
		got := 0
		for _, f := range zr.File {
			base := filepath.Base(f.Name)
			l := strings.ToLower(base)
			if !(l == "whisper-cli.exe" || (strings.HasSuffix(l, ".dll") && l != "sdl2.dll")) {
				continue
			}
			rc, err := f.Open()
			if err != nil {
				return err
			}
			b, err := io.ReadAll(rc)
			rc.Close()
			if err != nil {
				return err
			}
			if err := writeAtomic(filepath.Join(whisperDir(), base), b); err != nil {
				return err
			}
			got++
		}
		if !exists(whisperCLI()) {
			return errors.New("в архиве whisper.cpp нет whisper-cli.exe")
		}
		_ = got
	}
	if !exists(whisperModelPath()) {
		stage("модель речи (~570 МБ)")
		m, err := download(whisperModelURL, 570<<20)
		if err != nil {
			return fmt.Errorf("не скачалась модель речи: %w", err)
		}
		if len(m) < 50<<20 {
			return errors.New("скачался не тот файл модели речи")
		}
		if err := writeAtomic(whisperModelPath(), m); err != nil {
			return err
		}
	}
	return nil
}

type transcribeReq struct {
	In   string  `json:"in"`
	SS   float64 `json:"ss"`
	Dur  float64 `json:"dur"`
	Lang string  `json:"lang"` // auto | ru | uk | en …
}

// Word — слово (или кусок) с временем от начала куска, секунды.
type Word struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Text  string  `json:"text"`
}

// parseWhisperJSON — слова из JSON whisper-cli (-oj -ml 1 -sow: один сегмент ≈ одно слово).
func parseWhisperJSON(b []byte) ([]Word, string, error) {
	var doc struct {
		Result struct {
			Language string `json:"language"`
		} `json:"result"`
		Transcription []struct {
			Offsets struct {
				From int64 `json:"from"`
				To   int64 `json:"to"`
			} `json:"offsets"`
			Text string `json:"text"`
		} `json:"transcription"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		return nil, "", fmt.Errorf("не разобрал ответ whisper: %w", err)
	}
	var words []Word
	for _, s := range doc.Transcription {
		t := strings.TrimSpace(s.Text)
		if t == "" || strings.HasPrefix(t, "[") && strings.HasSuffix(t, "]") {
			continue // [Музыка], [_BEG_] и т. п.
		}
		w := Word{Start: float64(s.Offsets.From) / 1000, End: float64(s.Offsets.To) / 1000, Text: t}
		// Знак препинания отдельным «словом» — приклеить к предыдущему.
		if len(words) > 0 && strings.Trim(t, ".,!?;:…»)\"'") == "" {
			words[len(words)-1].Text += t
			words[len(words)-1].End = w.End
			continue
		}
		words = append(words, w)
	}
	return words, doc.Result.Language, nil
}

var reWhisperProgress = regexp.MustCompile(`progress\s*=\s*(\d+)%`)

func transcribe(req transcribeReq, progress func(float64)) (map[string]any, error) {
	ff := ffmpegPath()
	if ff == "" {
		return nil, errors.New("нет ffmpeg")
	}
	tmp, err := os.MkdirTemp("", "pa-subs-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	wav := filepath.Join(tmp, "a.wav")
	args := []string{"-v", "error", "-y"}
	if req.SS > 0 {
		args = append(args, "-ss", fmtSec(req.SS))
	}
	if req.Dur > 0 {
		args = append(args, "-t", fmtSec(req.Dur))
	}
	args = append(args, "-i", req.In, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav)
	cmd := exec.Command(ff, args...)
	hideWindow(cmd)
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("ffmpeg не достал звук: %s", lastLines(string(out), 2))
	}
	progress(0.05)

	lang := strings.ToLower(strings.TrimSpace(req.Lang))
	if lang == "" {
		lang = "auto"
	}
	base := filepath.Join(tmp, "out")
	w := exec.Command(whisperCLI(), "-m", whisperModelPath(), "-f", wav, "-l", lang, "-oj", "-of", base,
		"-ml", "1", "-sow", "-pp", "-t", strconv.Itoa(max(1, runtime.NumCPU()-1)))
	w.Dir = filepath.Dir(whisperCLI())
	hideWindow(w)
	stderr, err := w.StderrPipe()
	if err != nil {
		return nil, err
	}
	w.Stdout = io.Discard
	if err := w.Start(); err != nil {
		return nil, fmt.Errorf("whisper не запустился: %w", err)
	}
	var tail []string
	sc := bufio.NewScanner(stderr)
	for sc.Scan() {
		l := sc.Text()
		if m := reWhisperProgress.FindStringSubmatch(l); m != nil {
			p, _ := strconv.Atoi(m[1])
			progress(0.05 + 0.9*float64(p)/100)
		}
		tail = append(tail, l)
		if len(tail) > 4 {
			tail = tail[1:]
		}
	}
	if err := w.Wait(); err != nil {
		return nil, fmt.Errorf("whisper остановился: %s", strings.Join(tail, " "))
	}
	b, err := os.ReadFile(base + ".json")
	if err != nil {
		return nil, errors.New("whisper не записал результат")
	}
	words, detected, err := parseWhisperJSON(b)
	if err != nil {
		return nil, err
	}
	return map[string]any{"words": words, "language": detected}, nil
}
