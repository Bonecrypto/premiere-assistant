// Скачать из zip-архива на сервере только один файл (HTTP Range): из пакета DirectML на 200 МБ
// нужна одна библиотека на 18 МБ. Если сервер не умеет Range — качаем архив целиком.
package main

import (
	"archive/zip"
	"bytes"
	"compress/flate"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

var httpClient = &http.Client{Timeout: 30 * time.Minute}

type rangeReader struct {
	url   string
	size  int64
	cache map[int64][]byte
}

const rangeBlock = 256 << 10

func (r *rangeReader) get(off, n int64) ([]byte, error) {
	req, _ := http.NewRequest("GET", r.url, nil)
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", off, off+n-1))
	res, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusPartialContent {
		return nil, errors.New("сервер не отдаёт части файла")
	}
	return io.ReadAll(res.Body)
}

// ReadAt — блоками по 256 КБ с кэшем (zip читает каталог мелкими кусками).
func (r *rangeReader) ReadAt(p []byte, off int64) (int, error) {
	n := 0
	for n < len(p) {
		pos := off + int64(n)
		if pos >= r.size {
			return n, io.EOF
		}
		blk := pos / rangeBlock * rangeBlock
		b, ok := r.cache[blk]
		if !ok {
			var err error
			b, err = r.get(blk, min(rangeBlock, r.size-blk))
			if err != nil {
				return n, err
			}
			r.cache[blk] = b
		}
		n += copy(p[n:], b[pos-blk:])
	}
	return n, nil
}

func contentLength(url string) (int64, bool, error) {
	res, err := httpClient.Head(url)
	if err != nil {
		return 0, false, err
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		return 0, false, fmt.Errorf("сервер ответил %d", res.StatusCode)
	}
	return res.ContentLength, strings.Contains(res.Header.Get("Accept-Ranges"), "bytes"), nil
}

// fetchZipEntry — файл из zip по url, путь которого оканчивается на suffix (без учёта регистра).
func fetchZipEntry(url, suffix string, sizeHint int64) ([]byte, error) {
	size, ranges, err := contentLength(url)
	if err == nil && ranges && size > 0 {
		rr := &rangeReader{url: url, size: size, cache: map[int64][]byte{}}
		if zr, err := zip.NewReader(rr, size); err == nil {
			for _, f := range zr.File {
				if !strings.HasSuffix(strings.ToLower(f.Name), strings.ToLower(suffix)) {
					continue
				}
				off, err := f.DataOffset()
				if err != nil {
					break
				}
				setup.Lock()
				setup.total += int64(f.CompressedSize64)
				setup.Unlock()
				comp, err := downloadRange(url, off, int64(f.CompressedSize64))
				if err != nil {
					break
				}
				switch f.Method {
				case zip.Store:
					return comp, nil
				case zip.Deflate:
					return io.ReadAll(flate.NewReader(bytes.NewReader(comp)))
				}
				break
			}
		}
	}
	// Запасной путь — весь архив.
	arc, err := download(url, sizeHint)
	if err != nil {
		return nil, err
	}
	zr, err := zip.NewReader(bytes.NewReader(arc), int64(len(arc)))
	if err != nil {
		return nil, err
	}
	for _, f := range zr.File {
		if strings.HasSuffix(strings.ToLower(f.Name), strings.ToLower(suffix)) {
			rc, err := f.Open()
			if err != nil {
				return nil, err
			}
			defer rc.Close()
			return io.ReadAll(rc)
		}
	}
	return nil, errors.New("в архиве нет " + suffix)
}

// downloadRange — кусок файла одним запросом, с прогрессом.
func downloadRange(url string, off, n int64) ([]byte, error) {
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", off, off+n-1))
	res, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusPartialContent {
		return nil, errors.New("сервер не отдаёт части файла")
	}
	var buf bytes.Buffer
	if _, err := io.Copy(counter{&buf, &setup.done}, res.Body); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
