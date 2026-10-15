package main

import (
	_ "embed"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	launcherVersion = "1.0.21"
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
		return "", errors.New("LOCALAPPDATA is not defined")
	}
	return filepath.Join(root, "SmartHomeCalc"), nil
}

func extractExecutable(target, name string, content []byte) error {
	destination := filepath.Join(target, name)
	temporary := destination + ".launcher-tmp"
	if err := os.WriteFile(temporary, content, 0755); err != nil {
		return err
	}
	if err := os.Remove(destination); err != nil && !errors.Is(err, os.ErrNotExist) {
		os.Remove(temporary)
		return err
	}
	if err := os.Rename(temporary, destination); err != nil {
		os.Remove(temporary)
		return err
	}
	return nil
}

func fail(message string, err error) {
	text := message
	if err != nil {
		text += "\n\n" + err.Error()
	}
	if logFile != nil {
		fmt.Fprintln(logFile, text)
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

	versionFile := filepath.Join(directory, ".launcher-version")
	installedVersion, _ := os.ReadFile(versionFile)
	update := strings.TrimSpace(string(installedVersion)) != launcherVersion
	for name, content := range map[string][]byte{desktopHostName: desktopHost, backendName: backend} {
		if _, err := os.Stat(filepath.Join(directory, name)); update || errors.Is(err, os.ErrNotExist) {
			if err := extractExecutable(directory, name, content); err != nil {
				fail("Не удалось обновить приложение. Закройте Smart Home Calc и повторите запуск.", err)
			}
		}
	}
	if update {
		if err := os.WriteFile(versionFile, []byte(launcherVersion+"\n"), 0644); err != nil {
			fail("Не удалось сохранить версию приложения.", err)
		}
	}

	command := exec.Command(filepath.Join(directory, desktopHostName))
	command.Dir = directory
	if err := command.Start(); err != nil {
		fail("Не удалось открыть Smart Home Calc.", err)
	}
}
