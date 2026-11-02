//go:build windows

// Premiere Assistant — клавиши для автопокраски таймлайна.
//
// Маленькая программа без окон: значок в трее (возле часов), правый клик — «Выход».
// Слушает только этот компьютер (127.0.0.1 и ::1, порт 8766). Принимает от панели Premiere Assistant
// только разрешённые комбинации: Shift+3 (фокус таймлайна) и клавиши меток Ctrl+Alt+Shift+1…9, 0, F1…F6.
// Команда /keys принимается только с заголовком X-Premiere-Assistant: 1 — сайты в браузере такой отправить не могут.
// Сама закрывается через минуту после закрытия Premiere.
package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

// ───────── Win32 ─────────

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	shell32  = syscall.NewLazyDLL("shell32.dll")

	pKeybdEvent               = user32.NewProc("keybd_event")
	pGetForegroundWindow      = user32.NewProc("GetForegroundWindow")
	pSetForegroundWindow      = user32.NewProc("SetForegroundWindow")
	pEnumWindows              = user32.NewProc("EnumWindows")
	pIsWindowVisible          = user32.NewProc("IsWindowVisible")
	pGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	pRegisterClassExW         = user32.NewProc("RegisterClassExW")
	pCreateWindowExW          = user32.NewProc("CreateWindowExW")
	pDefWindowProcW           = user32.NewProc("DefWindowProcW")
	pGetMessageW              = user32.NewProc("GetMessageW")
	pTranslateMessage         = user32.NewProc("TranslateMessage")
	pDispatchMessageW         = user32.NewProc("DispatchMessageW")
	pPostQuitMessage          = user32.NewProc("PostQuitMessage")
	pPostMessageW             = user32.NewProc("PostMessageW")
	pLoadIconW                = user32.NewProc("LoadIconW")
	pCreatePopupMenu          = user32.NewProc("CreatePopupMenu")
	pAppendMenuW              = user32.NewProc("AppendMenuW")
	pTrackPopupMenu           = user32.NewProc("TrackPopupMenu")
	pGetCursorPos             = user32.NewProc("GetCursorPos")
	pDestroyMenu              = user32.NewProc("DestroyMenu")
	pMessageBoxW              = user32.NewProc("MessageBoxW")

	pCreateMutexW              = kernel32.NewProc("CreateMutexW")
	pGetModuleHandleW          = kernel32.NewProc("GetModuleHandleW")
	pOpenProcess               = kernel32.NewProc("OpenProcess")
	pCloseHandle               = kernel32.NewProc("CloseHandle")
	pQueryFullProcessImageName = kernel32.NewProc("QueryFullProcessImageNameW")
	pCreateToolhelp32Snapshot  = kernel32.NewProc("CreateToolhelp32Snapshot")
	pProcess32FirstW           = kernel32.NewProc("Process32FirstW")
	pProcess32NextW            = kernel32.NewProc("Process32NextW")

	pShellNotifyIconW = shell32.NewProc("Shell_NotifyIconW")
)

const (
	keyeventfKeyup = 0x0002
	vkShift        = 0x10
	vkControl      = 0x11
	vkMenu         = 0x12
	wmUser         = 0x0400
	wmTray         = wmUser + 1
	wmCommand      = 0x0111
	wmDestroy      = 0x0002
	wmClose        = 0x0010
	wmRButtonUp    = 0x0205
	wmLButtonUp    = 0x0202
	nimAdd         = 0
	nimDelete      = 2
	nifMessage     = 1
	nifIcon        = 2
	nifTip         = 4
	mfString       = 0
	mfGrayed       = 1
	tpmRightButton = 2
	idExit         = 1
)

func utf16(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }

// ───────── Premiere ─────────

func exeName(pid uint32) string {
	h, _, _ := pOpenProcess.Call(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, 0, uintptr(pid))
	if h == 0 {
		return ""
	}
	defer pCloseHandle.Call(h)
	buf := make([]uint16, 1024)
	n := uint32(len(buf))
	r, _, _ := pQueryFullProcessImageName.Call(h, 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&n)))
	if r == 0 {
		return ""
	}
	return strings.ToLower(syscall.UTF16ToString(buf[:n]))
}

func isPremiere(name string) bool { return strings.Contains(name, "adobe premiere pro") }

type processEntry32 struct {
	Size            uint32
	Usage           uint32
	ProcessID       uint32
	DefaultHeapID   uintptr
	ModuleID        uint32
	Threads         uint32
	ParentProcessID uint32
	PriClassBase    int32
	Flags           uint32
	ExeFile         [260]uint16
}

func premiereRunning() bool {
	snap, _, _ := pCreateToolhelp32Snapshot.Call(0x2 /* TH32CS_SNAPPROCESS */, 0)
	if snap == 0 || snap == ^uintptr(0) {
		return true // не знаем — считаем, что запущен
	}
	defer pCloseHandle.Call(snap)
	var e processEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	for r, _, _ := pProcess32FirstW.Call(snap, uintptr(unsafe.Pointer(&e))); r != 0; r, _, _ = pProcess32NextW.Call(snap, uintptr(unsafe.Pointer(&e))) {
		if isPremiere(strings.ToLower(syscall.UTF16ToString(e.ExeFile[:]))) {
			return true
		}
	}
	return false
}

func premiereWindow() uintptr {
	if fg, _, _ := pGetForegroundWindow.Call(); fg != 0 {
		var pid uint32
		pGetWindowThreadProcessId.Call(fg, uintptr(unsafe.Pointer(&pid)))
		if isPremiere(exeName(pid)) {
			return fg
		}
	}
	var found uintptr
	cb := syscall.NewCallback(func(h, _ uintptr) uintptr {
		if v, _, _ := pIsWindowVisible.Call(h); v == 0 {
			return 1
		}
		var pid uint32
		pGetWindowThreadProcessId.Call(h, uintptr(unsafe.Pointer(&pid)))
		if isPremiere(exeName(pid)) {
			found = h
			return 0
		}
		return 1
	})
	pEnumWindows.Call(cb, 0)
	return found
}

// ───────── Клавиши ─────────

func vkOf(key string) (byte, bool) {
	if len(key) == 1 && key[0] >= '0' && key[0] <= '9' {
		return key[0], true // VK_0…VK_9 = '0'…'9'
	}
	if strings.HasPrefix(key, "f") {
		if n, err := strconv.Atoi(key[1:]); err == nil && n >= 1 && n <= 12 {
			return byte(0x70 + n - 1), true
		}
	}
	return 0, false
}

func press(vk byte, up bool) {
	var flags uintptr
	if up {
		flags = keyeventfKeyup
	}
	pKeybdEvent.Call(uintptr(vk), 0, flags, 0)
}

var keyMu sync.Mutex

func sendCombo(combo string) error {
	parts := strings.Split(strings.ToLower(combo), "+")
	vk, ok := vkOf(parts[len(parts)-1])
	if !ok {
		return fmt.Errorf("неизвестная клавиша %q", combo)
	}
	var mods []byte
	for _, m := range parts[:len(parts)-1] {
		switch m {
		case "ctrl":
			mods = append(mods, vkControl)
		case "alt":
			mods = append(mods, vkMenu)
		case "shift":
			mods = append(mods, vkShift)
		}
	}
	for _, m := range mods {
		press(m, false)
	}
	press(vk, false)
	time.Sleep(30 * time.Millisecond)
	press(vk, true)
	for i := len(mods) - 1; i >= 0; i-- {
		press(mods[i], true)
	}
	return nil
}

func init() { sendKeys = winSendKeys }

func winSendKeys(keys []string) error {
	keyMu.Lock()
	defer keyMu.Unlock()
	w := premiereWindow()
	if w == 0 {
		return fmt.Errorf("Premiere Pro не запущен")
	}
	if fg, _, _ := pGetForegroundWindow.Call(); fg != w {
		pSetForegroundWindow.Call(w)
		time.Sleep(150 * time.Millisecond)
	}
	for _, k := range keys {
		if err := sendCombo(k); err != nil {
			return err
		}
		time.Sleep(140 * time.Millisecond)
	}
	return nil
}

// ───────── Значок в трее ─────────

type notifyIconData struct {
	CbSize           uint32
	HWnd             uintptr
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            uintptr
	SzTip            [128]uint16
	DwState          uint32
	DwStateMask      uint32
	SzInfo           [256]uint16
	UVersion         uint32
	SzInfoTitle      [64]uint16
	DwInfoFlags      uint32
	GuidItem         [16]byte
	HBalloonIcon     uintptr
}

type wndClassEx struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   uintptr
	Icon       uintptr
	Cursor     uintptr
	Background uintptr
	MenuName   *uint16
	ClassName  *uint16
	IconSm     uintptr
}

type msg struct {
	HWnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      struct{ X, Y int32 }
}

var nid notifyIconData

func wndProc(h uintptr, m uint32, w, l uintptr) uintptr {
	switch m {
	case wmTray:
		if l == wmRButtonUp || l == wmLButtonUp {
			menu, _, _ := pCreatePopupMenu.Call()
			pAppendMenuW.Call(menu, mfString|mfGrayed, 0, uintptr(unsafe.Pointer(utf16("Premiere Assistant — клавиши для покраски"))))
			pAppendMenuW.Call(menu, mfString, idExit, uintptr(unsafe.Pointer(utf16("Выход"))))
			var pt struct{ X, Y int32 }
			pGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
			pSetForegroundWindow.Call(h)
			pTrackPopupMenu.Call(menu, tpmRightButton, uintptr(pt.X), uintptr(pt.Y), 0, h, 0)
			pDestroyMenu.Call(menu)
		}
		return 0
	case wmCommand:
		if w&0xffff == idExit {
			pPostMessageW.Call(h, wmClose, 0, 0)
		}
		return 0
	case wmDestroy:
		pShellNotifyIconW.Call(nimDelete, uintptr(unsafe.Pointer(&nid)))
		pPostQuitMessage.Call(0)
		return 0
	}
	r, _, _ := pDefWindowProcW.Call(h, uintptr(m), w, l)
	return r
}

func main() {
	// Только один экземпляр.
	_, _, e := pCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(utf16("Local\\PremiereAssistantKeys"))))
	if e == syscall.Errno(183) /* ERROR_ALREADY_EXISTS */ {
		os.Exit(0)
	}

	ok4 := serve(fmt.Sprintf("127.0.0.1:%d", port))
	ok6 := serve(fmt.Sprintf("[::1]:%d", port))
	if !ok4 && !ok6 {
		pMessageBoxW.Call(0, uintptr(unsafe.Pointer(utf16(fmt.Sprintf("Порт %d занят — возможно, программа уже запущена.", port)))),
			uintptr(unsafe.Pointer(utf16("Premiere Assistant"))), 0x30)
		os.Exit(1)
	}

	inst, _, _ := pGetModuleHandleW.Call(0)
	cls := utf16("PremiereAssistantKeys")
	wc := wndClassEx{WndProc: syscall.NewCallback(wndProc), Instance: inst, ClassName: cls}
	wc.Size = uint32(unsafe.Sizeof(wc))
	pRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))
	hwnd, _, _ := pCreateWindowExW.Call(0, uintptr(unsafe.Pointer(cls)), uintptr(unsafe.Pointer(cls)), 0, 0, 0, 0, 0, 0, 0, inst, 0)

	icon, _, _ := pLoadIconW.Call(inst, 1) // значок из ресурсов (если есть)
	if icon == 0 {
		icon, _, _ = pLoadIconW.Call(0, 32512) // IDI_APPLICATION
	}
	nid.CbSize = uint32(unsafe.Sizeof(nid))
	nid.HWnd = hwnd
	nid.UID = 1
	nid.UFlags = nifMessage | nifIcon | nifTip
	nid.UCallbackMessage = wmTray
	nid.HIcon = icon
	copy(nid.SzTip[:], syscall.StringToUTF16("Premiere Assistant — клавиши для покраски таймлайна"))
	pShellNotifyIconW.Call(nimAdd, uintptr(unsafe.Pointer(&nid)))

	// Выключиться через минуту после закрытия Premiere.
	go func() {
		last := time.Now()
		for range time.Tick(15 * time.Second) {
			if premiereRunning() {
				last = time.Now()
			} else if time.Since(last) > time.Minute {
				pPostMessageW.Call(hwnd, wmClose, 0, 0)
				return
			}
		}
	}()

	var m msg
	for {
		r, _, _ := pGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		pTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		pDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
}
