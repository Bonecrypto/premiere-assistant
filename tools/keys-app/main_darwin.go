//go:build darwin

// Premiere Assistant Helper для macOS: то же, что программа в трее на Windows, но без значка
// (приложение-агент, LSUIElement). Слушает только 127.0.0.1 / ::1:8766. Нажимает клавиши в Premiere
// через CGEvent — нужно разрешение «Универсальный доступ» (Системные настройки → Конфиденциальность).
// Ctrl из команд панели на Mac — это ⌘ Command, Alt — ⌥ Option. Сам закрывается через минуту после закрытия Premiere.
package main

/*
#cgo LDFLAGS: -framework ApplicationServices -framework CoreFoundation
#include <ApplicationServices/ApplicationServices.h>

// Есть ли разрешение «Универсальный доступ»; prompt=1 — macOS сама покажет окно с запросом.
static int pa_trusted(int prompt) {
	const void *keys[] = { kAXTrustedCheckOptionPrompt };
	const void *vals[] = { prompt ? kCFBooleanTrue : kCFBooleanFalse };
	CFDictionaryRef opts = CFDictionaryCreate(NULL, keys, vals, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
	int ok = AXIsProcessTrustedWithOptions(opts) ? 1 : 0;
	CFRelease(opts);
	return ok;
}

static void pa_key(int code, unsigned long long flags, int down) {
	CGEventRef ev = CGEventCreateKeyboardEvent(NULL, (CGKeyCode)code, down ? true : false);
	if (!ev) return;
	CGEventSetFlags(ev, (CGEventFlags)flags);
	CGEventPost(kCGHIDEventTap, ev);
	CFRelease(ev);
}
*/
import "C"

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// Коды клавиш macOS (раскладка ANSI, не зависят от языка ввода).
var macKey = map[string]int{
	"q": 0x0C, "w": 0x0D, "e": 0x0E, "t": 0x11, "y": 0x10, "u": 0x20, "i": 0x22, "o": 0x1F, "k": 0x28,
	"2": 0x13, "3": 0x14, "4": 0x15, "5": 0x17, "6": 0x16, "7": 0x1A, "8": 0x1C, "9": 0x19,
}

const (
	flagShift = 0x20000
	flagCmd   = 0x100000
	flagOpt   = 0x80000
)

// premiereApp — имя запущенного Premiere («Adobe Premiere Pro 2025»), пусто — не запущен.
func premiereApp() string {
	out, err := exec.Command("/bin/ps", "-axco", "comm").Output()
	if err != nil {
		return ""
	}
	for _, l := range strings.Split(string(out), "\n") {
		l = strings.TrimSpace(l)
		if strings.HasPrefix(l, "Adobe Premiere Pro") {
			return l
		}
	}
	return ""
}

var keyMu sync.Mutex

func macSendKeys(keys []string) error {
	keyMu.Lock()
	defer keyMu.Unlock()
	if C.pa_trusted(0) == 0 {
		C.pa_trusted(1)
		return errors.New("разрешите «Универсальный доступ» для Premiere Assistant Helper: Системные настройки → Конфиденциальность и безопасность → Универсальный доступ, затем нажмите ещё раз")
	}
	app := premiereApp()
	if app == "" {
		return errors.New("Premiere Pro не запущен")
	}
	// Вывести Premiere на передний план (open -a активирует уже запущенное приложение).
	exec.Command("/usr/bin/open", "-a", app).Run()
	time.Sleep(250 * time.Millisecond)
	for _, k := range keys {
		parts := strings.Split(strings.ToLower(k), "+")
		code, ok := macKey[parts[len(parts)-1]]
		if !ok {
			return fmt.Errorf("неизвестная клавиша %q", k)
		}
		var flags C.ulonglong
		for _, m := range parts[:len(parts)-1] {
			switch m {
			case "ctrl":
				flags |= flagCmd // Ctrl на Windows = ⌘ на Mac
			case "alt":
				flags |= flagOpt
			case "shift":
				flags |= flagShift
			}
		}
		C.pa_key(C.int(code), flags, 1)
		time.Sleep(30 * time.Millisecond)
		C.pa_key(C.int(code), flags, 0)
		time.Sleep(140 * time.Millisecond)
	}
	return nil
}

func init() { sendKeys = macSendKeys }

func main() {
	ok4, ok6 := false, false
	for i := 0; i < 10 && !ok4 && !ok6; i++ {
		ok4 = serve(fmt.Sprintf("127.0.0.1:%d", port))
		ok6 = serve(fmt.Sprintf("[::1]:%d", port))
		if !ok4 && !ok6 {
			time.Sleep(300 * time.Millisecond)
		}
	}
	if !ok4 && !ok6 {
		os.Exit(1) // порт занят — уже запущена другая копия
	}
	// Спросить разрешение сразу при первом запуске (окно macOS), а не посреди покраски.
	C.pa_trusted(1)

	quit := make(chan struct{}, 1)
	onQuit = func() { quit <- struct{}{} }
	go func() {
		last := time.Now()
		for range time.Tick(15 * time.Second) {
			if premiereApp() != "" {
				last = time.Now()
			} else if time.Since(last) > time.Minute {
				quit <- struct{}{}
				return
			}
		}
	}()
	<-quit
}
