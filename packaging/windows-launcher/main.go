package main

import (
	_ "embed"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"
)

const (
	launcherVersion = "1.0.62"
	desktopHostName = "SmartHomeCalc.Desktop.exe"
	backendName     = "SmartHomeCalc.Backend.exe"
)

//go:embed SmartHomeCalc.Desktop.exe
var desktopHost []byte

//go:embed SmartHomeCalc.Backend.exe
var backend []byte

var (
	messageBox = syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
	logFile    *os.File
)

func showMessage(title, message string, flags uintptr) {
	titlePtr, _ := syscall.UTF16PtrFromString(title)
	messagePtr, _ := syscall.UTF16PtrFromString(message)
	messageBox.Call(0, uintptr(unsafe.Pointer(messagePtr)), uintptr(unsafe.Pointer(titlePtr)), flags)
}

func installDirectory() (string, error) {
	root := os.Getenv("LOCALAPPDATA")
	if root == "" {
		return "", errors.New("Не определена папка локальных данных пользователя")
	}
	return filepath.Join(root, "SmartHomeCalc"), nil
}

func fail(message string, err error) {
	text := message
	if logFile != nil {
		fmt.Fprintln(logFile, message)
		if err != nil {
			fmt.Fprintln(logFile, err)
		}
		text += "\n\nПодробности ошибки записаны в журнал запуска в папке приложения."
	}
	showMessage("Smart Home Calc", text, 0x10)
	os.Exit(1)
}

func main() {
	directory, err := installDirectory()
	if err != nil {
		fail("Не удалось определить папку установки.", err)
	}
	if err := os.MkdirAll(directory, 0755); err != nil {
		fail("Не удалось создать папку установки.", err)
	}
	logFile, _ = os.OpenFile(filepath.Join(directory, "launcher.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if logFile != nil {
		defer logFile.Close()
		fmt.Fprintf(logFile, "\n%s launcher %s\n", time.Now().Format(time.RFC3339), launcherVersion)
	}

	if needsInstall(directory, launcherVersion) {
		mutexName, _ := syscall.UTF16PtrFromString(`Local\SmartHomeCalc.Desktop`)
		kernel := syscall.NewLazyDLL("kernel32.dll")
		handle, _, _ := kernel.NewProc("OpenMutexW").Call(0x00100000, 0, uintptr(unsafe.Pointer(mutexName)))
		if handle != 0 {
			kernel.NewProc("CloseHandle").Call(handle)
			fail("Закройте Smart Home Calc перед обновлением и запустите EXE ещё раз.", nil)
		}
		previous, err := installVersion(directory, launcherVersion, map[string][]byte{desktopHostName: desktopHost, backendName: backend})
		if err != nil {
			fail("Не удалось обновить приложение. Проверьте свободное место и повторите запуск.", err)
		}
		if logFile != nil && previous != "" {
			fmt.Fprintf(logFile, "Previous application preserved: %s\n", previous)
		}
	}

	command := exec.Command(filepath.Join(directory, desktopHostName))
	command.Dir = directory
	if err := command.Start(); err != nil {
		fail("Не удалось открыть Smart Home Calc.", err)
	}
}
