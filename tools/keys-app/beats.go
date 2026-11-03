// Поиск битов в музыке: ffmpeg → моно 22 050 Гц → «сила удара» (спектральный поток) → темп (автокорреляция)
// → биты динамическим программированием (D. Ellis, «Beat Tracking by Dynamic Programming», 2007). Без библиотек.
package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"math/cmplx"
	"os/exec"
)

const (
	beatSR  = 22050
	beatWin = 1024
	beatHop = 512
)

type beatsReq struct {
	In  string  `json:"in"`
	SS  float64 `json:"ss"`
	Dur float64 `json:"dur"`
}

// fft — радикс-2 на месте (len — степень двойки).
func fft(a []complex128) {
	n := len(a)
	for i, j := 1, 0; i < n; i++ {
		bit := n >> 1
		for ; j&bit != 0; bit >>= 1 {
			j ^= bit
		}
		j ^= bit
		if i < j {
			a[i], a[j] = a[j], a[i]
		}
	}
	for size := 2; size <= n; size <<= 1 {
		w := cmplx.Exp(complex(0, -2*math.Pi/float64(size)))
		for start := 0; start < n; start += size {
			wk := complex(1, 0)
			for k := 0; k < size/2; k++ {
				u := a[start+k]
				v := a[start+k+size/2] * wk
				a[start+k] = u + v
				a[start+k+size/2] = u - v
				wk *= w
			}
		}
	}
}

// onsetEnvelope — сила «удара» на каждый шаг (hop) звука.
func onsetEnvelope(x []float64) []float64 {
	if len(x) < beatWin {
		return nil
	}
	nf := (len(x)-beatWin)/beatHop + 1
	hann := make([]float64, beatWin)
	for i := range hann {
		hann[i] = 0.5 - 0.5*math.Cos(2*math.Pi*float64(i)/beatWin)
	}
	prev := make([]float64, beatWin/2)
	cur := make([]float64, beatWin/2)
	buf := make([]complex128, beatWin)
	env := make([]float64, nf)
	for f := 0; f < nf; f++ {
		off := f * beatHop
		for i := 0; i < beatWin; i++ {
			buf[i] = complex(x[off+i]*hann[i], 0)
		}
		fft(buf)
		flux := 0.0
		for k := 1; k < beatWin/2; k++ {
			cur[k] = math.Log1p(10 * cmplx.Abs(buf[k]))
			if d := cur[k] - prev[k]; d > 0 && f > 0 {
				flux += d
			}
		}
		env[f] = flux
		prev, cur = cur, prev
	}
	// Убрать медленный фон (скользящее среднее ~0.5 с), оставить только всплески, привести к единичному разбросу.
	w := beatSR / 2 / beatHop
	out := make([]float64, nf)
	sum := 0.0
	for i := 0; i < nf; i++ {
		sum += env[i]
		if i >= w {
			sum -= env[i-w]
		}
		mean := sum / float64(min(i+1, w))
		out[i] = math.Max(0, env[i]-mean)
	}
	var s, s2 float64
	for _, v := range out {
		s += v
		s2 += v * v
	}
	n := float64(len(out))
	sd := math.Sqrt(math.Max(1e-12, s2/n-(s/n)*(s/n)))
	for i := range out {
		out[i] /= sd
	}
	return out
}

// estimatePeriod — период бита в шагах (60–200 BPM), с предпочтением около 120 BPM.
func estimatePeriod(env []float64) float64 {
	fps := float64(beatSR) / beatHop
	lo := int(fps * 60 / 200)
	hi := int(fps * 60 / 60)
	best, bestScore := 0, -1.0
	for lag := lo; lag <= hi && lag < len(env); lag++ {
		ac := 0.0
		for i := lag; i < len(env); i++ {
			ac += env[i] * env[i-lag]
		}
		ac /= float64(len(env) - lag)
		bpm := 60 * fps / float64(lag)
		wgt := math.Exp(-0.5 * math.Pow(math.Log2(bpm/120)/1.0, 2))
		if sc := ac * wgt; sc > bestScore {
			best, bestScore = lag, sc
		}
	}
	if best == 0 {
		return fps / 2 // 120 BPM
	}
	// Уточнить период параболой по соседям.
	return float64(best)
}

// trackBeats — биты (номера шагов) динамическим программированием.
func trackBeats(env []float64, period float64) []int {
	n := len(env)
	if n == 0 {
		return nil
	}
	const tight = 100.0
	score := make([]float64, n)
	back := make([]int, n)
	for t := 0; t < n; t++ {
		bestV, bestI := math.Inf(-1), -1
		for tau := t - int(2*period); tau <= t-int(period/2); tau++ {
			if tau < 0 {
				continue
			}
			pen := math.Log(float64(t-tau) / period)
			v := score[tau] - tight*pen*pen
			if v > bestV {
				bestV, bestI = v, tau
			}
		}
		if bestI >= 0 && bestV > 0 {
			score[t] = env[t] + bestV
			back[t] = bestI
		} else {
			score[t] = env[t]
			back[t] = -1
		}
	}
	// Конец — лучший счёт в последнем периоде.
	end := n - 1
	for t := max(0, n-int(period)); t < n; t++ {
		if score[t] > score[end] {
			end = t
		}
	}
	var beats []int
	for t := end; t >= 0; t = back[t] {
		beats = append([]int{t}, beats...)
		if back[t] < 0 {
			break
		}
	}
	return beats
}

func detectBeats(req beatsReq, progress func(float64)) (map[string]any, error) {
	ff := ffmpegPath()
	if ff == "" {
		return nil, errors.New("нет ffmpeg")
	}
	args := []string{"-v", "error"}
	if req.SS > 0 {
		args = append(args, "-ss", fmtSec(req.SS))
	}
	if req.Dur > 0 {
		args = append(args, "-t", fmtSec(req.Dur))
	}
	args = append(args, "-i", req.In, "-vn", "-ac", "1", "-ar", fmt.Sprint(beatSR), "-f", "s16le", "-")
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
	if err != nil || len(raw) < beatSR {
		return nil, errors.New("в файле нет звука или он слишком короткий")
	}
	x := make([]float64, len(raw)/2)
	for i := range x {
		x[i] = float64(int16(binary.LittleEndian.Uint16(raw[i*2:]))) / 32768
	}
	progress(0.3)
	env := onsetEnvelope(x)
	progress(0.7)
	period := estimatePeriod(env)
	idx := trackBeats(env, period)
	sec := float64(beatHop) / beatSR
	beats := make([]float64, 0, len(idx))
	for _, i := range idx {
		// Шаг описывает окно; удар — примерно в его середине.
		beats = append(beats, math.Round((float64(i)*sec+float64(beatWin)/2/beatSR)*1000)/1000)
	}
	bpm := 60 / (period * sec)
	if len(beats) > 3 {
		// Точнее — по среднему расстоянию между битами (шаг анализа ≈23 мс огрубляет период).
		bpm = 60 * float64(len(beats)-1) / (beats[len(beats)-1] - beats[0])
	}
	return map[string]any{"beats": beats, "bpm": math.Round(bpm*10) / 10}, nil
}
