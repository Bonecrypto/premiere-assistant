package main

import (
	"os/exec"
	"syscall"
	"unsafe"
)

var pSetDllDirectoryW = syscall.NewLazyDLL("kernel32.dll").NewProc("SetDllDirectoryW")

// hideWindow — дочерний ffmpeg без чёрного окна консоли.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000 /* CREATE_NO_WINDOW */}
}

// prepareDllDir — чтобы onnxruntime.dll нашла рядом лежащую DirectML.dll.
func prepareDllDir(dir string) {
	if p, err := syscall.UTF16PtrFromString(dir); err == nil {
		pSetDllDirectoryW.Call(uintptr(unsafe.Pointer(p)))
	}
}
