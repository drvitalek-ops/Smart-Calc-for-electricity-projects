package main

import (
	"archive/zip"
	"bytes"
	_ "embed"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	launcherVersion = "0.1.0"
	appURL          = "http://localhost:5173"
)

//go:embed payload.zip
var payload []byte

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

func extractApplication(target string) error {
	reader, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return fmt.Errorf("open embedded application: %w", err)
	}
	for _, item := range reader.File {
		clean := filepath.Clean(filepath.FromSlash(item.Name))
		if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
			return fmt.Errorf("unsafe embedded path: %s", item.Name)
		}
		destination := filepath.Join(target, clean)
		if item.FileInfo().IsDir() {
			if err := os.MkdirAll(destination, 0755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
			return err
		}
		source, err := item.Open()
		if err != nil {
			return err
		}
		temporary := destination + ".launcher-tmp"
		output, err := os.OpenFile(temporary, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
		if err == nil {
			_, err = io.Copy(output, source)
		}
		closeErr := source.Close()
		if output != nil {
			if outputErr := output.Close(); err == nil {
				err = outputErr
			}
		}
		if err == nil {
			err = closeErr
		}
		if err != nil {
			os.Remove(temporary)
			return err
		}
		os.Remove(destination)
		if err := os.Rename(temporary, destination); err != nil {
			return err
		}
	}
	return nil
}

func dockerExecutable() (string, error) {
	if path, err := exec.LookPath("docker.exe"); err == nil {
		return path, nil
	}
	programFiles := os.Getenv("ProgramFiles")
	if programFiles != "" {
		path := filepath.Join(programFiles, "Docker", "Docker", "resources", "bin", "docker.exe")
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
	}
	return "", errors.New("Docker Desktop is not installed")
}

func dockerReady(docker string) bool {
	command := exec.Command(docker, "info")
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	return command.Run() == nil
}

func startDockerDesktop() bool {
	programFiles := os.Getenv("ProgramFiles")
	if programFiles == "" {
		return false
	}
	path := filepath.Join(programFiles, "Docker", "Docker", "Docker Desktop.exe")
	if _, err := os.Stat(path); err != nil {
		return false
	}
	return exec.Command(path).Start() == nil
}

func waitForDocker(docker string) bool {
	for attempt := 0; attempt < 120; attempt++ {
		if dockerReady(docker) {
			return true
		}
		time.Sleep(2 * time.Second)
	}
	return false
}

func runCompose(docker, directory string, rebuild bool) error {
	arguments := []string{"compose", "up", "-d"}
	if rebuild {
		arguments = append(arguments, "--build")
	}
	command := exec.Command(docker, arguments...)
	command.Dir = directory
	command.Stdout = io.MultiWriter(os.Stdout, logFile)
	command.Stderr = io.MultiWriter(os.Stderr, logFile)
	return command.Run()
}

func waitForApplication() bool {
	client := http.Client{Timeout: 2 * time.Second}
	for attempt := 0; attempt < 90; attempt++ {
		response, err := client.Get(appURL)
		if err == nil {
			response.Body.Close()
			if response.StatusCode >= 200 && response.StatusCode < 500 {
				return true
			}
		}
		time.Sleep(time.Second)
	}
	return false
}

func openURL(url string) {
	_ = exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url).Start()
}

func fail(message string, err error) {
	text := message
	if err != nil {
		text += "\n\n" + err.Error()
	}
	if logFile != nil {
		fmt.Fprintln(logFile, text)
	}
	fmt.Fprintln(os.Stderr, text)
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
	rebuild := strings.TrimSpace(string(installedVersion)) != launcherVersion
	if rebuild {
		fmt.Println("Подготовка файлов Smart Home Calc...")
	}
	if err := extractApplication(directory); err != nil {
		fail("Не удалось распаковать приложение.", err)
	}
	docker, err := dockerExecutable()
	if err != nil {
		openURL("https://www.docker.com/products/docker-desktop/")
		fail("Установите Docker Desktop, затем снова запустите SmartHomeCalc.exe.", err)
	}
	if !dockerReady(docker) {
		fmt.Println("Запуск Docker Desktop...")
		if !startDockerDesktop() || !waitForDocker(docker) {
			fail("Docker Desktop не запущен. Запустите его и повторите попытку.", nil)
		}
	}
	if rebuild {
		showMessage("Smart Home Calc", "Первый запуск загрузит локальные компоненты и может занять несколько минут. Не закрывайте окно запуска.", 0x40)
	}
	fmt.Println("Запуск Smart Home Calc...")
	if err := runCompose(docker, directory, rebuild); err != nil {
		fail("Не удалось запустить приложение. Подробности записаны в launcher.log.", err)
	}
	if rebuild {
		if err := os.WriteFile(versionFile, []byte(launcherVersion+"\n"), 0644); err != nil {
			fail("Не удалось сохранить версию приложения.", err)
		}
	}
	if !waitForApplication() {
		fail("Приложение не ответило вовремя. Проверьте Docker Desktop и launcher.log.", nil)
	}
	fmt.Println("Smart Home Calc готов: " + appURL)
	openURL(appURL)
}
