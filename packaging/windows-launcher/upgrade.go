package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

var releaseVersion = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`)
var installedComponents = []string{"SmartHomeCalc.Backend.exe", "SmartHomeCalc.Desktop.exe"}

func regularFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular() && info.Size() > 0
}

func needsInstall(directory, version string) bool {
	saved, _ := os.ReadFile(filepath.Join(directory, ".launcher-version"))
	if strings.TrimSpace(string(saved)) != version {
		return true
	}
	for _, name := range installedComponents {
		if !regularFile(filepath.Join(directory, name)) {
			return true
		}
	}
	return false
}

func copyComponent(source, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0755)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	syncErr := output.Sync()
	closeErr := output.Close()
	return errors.Join(copyErr, syncErr, closeErr)
}

// Preserve a complete old pair before touching the installed executables. The
// old desktop can run directly from this folder after the current app is closed.
func preserveVersion(directory, version string) (string, error) {
	if !releaseVersion.MatchString(version) {
		return "", nil
	}
	for _, name := range installedComponents {
		if !regularFile(filepath.Join(directory, name)) {
			return "", nil
		}
	}
	parent := filepath.Join(directory, "rollback")
	if err := os.MkdirAll(parent, 0755); err != nil {
		return "", err
	}
	destination := filepath.Join(parent, "v"+version)
	if _, err := os.Stat(destination); err == nil {
		for _, name := range installedComponents {
			if !regularFile(filepath.Join(destination, name)) {
				return "", fmt.Errorf("incomplete rollback folder: %s", destination)
			}
		}
		return destination, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	temporary, err := os.MkdirTemp(parent, ".preserve-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(temporary)
	for _, name := range installedComponents {
		if err := copyComponent(filepath.Join(directory, name), filepath.Join(temporary, name)); err != nil {
			return "", err
		}
	}
	metadata, _ := json.MarshalIndent(map[string]string{"version": version, "created_at": time.Now().UTC().Format(time.RFC3339)}, "", "  ")
	if err := os.WriteFile(filepath.Join(temporary, "version.json"), metadata, 0644); err != nil {
		return "", err
	}
	launch := "@echo off\r\nstart \"\" \"%~dp0SmartHomeCalc.Desktop.exe\"\r\n"
	if err := os.WriteFile(filepath.Join(temporary, "Start-previous-version.cmd"), []byte(launch), 0644); err != nil {
		return "", err
	}
	if err := os.Rename(temporary, destination); err != nil {
		return "", err
	}
	return destination, nil
}

func installVersion(directory, version string, components map[string][]byte) (string, error) {
	return installVersionWithRename(directory, version, components, os.Rename)
}

func installVersionWithRename(directory, version string, components map[string][]byte, rename func(string, string) error) (string, error) {
	if !releaseVersion.MatchString(version) {
		return "", errors.New("invalid release version")
	}
	if len(components) != len(installedComponents) {
		return "", errors.New("incomplete application component pair")
	}
	for _, name := range installedComponents {
		if len(components[name]) == 0 {
			return "", errors.New("missing application component: " + name)
		}
	}
	names := make([]string, 0, len(components))
	for name, content := range components {
		if filepath.Base(name) != name || len(content) == 0 {
			return "", errors.New("invalid application component")
		}
		if info, err := os.Stat(filepath.Join(directory, name)); err == nil && !info.Mode().IsRegular() {
			return "", fmt.Errorf("component is not a regular file: %s", name)
		}
		names = append(names, name)
	}
	sort.Strings(names)
	previousBytes, previousErr := os.ReadFile(filepath.Join(directory, ".launcher-version"))
	previous := strings.TrimSpace(string(previousBytes))
	rollback := ""
	if previous != version {
		var err error
		rollback, err = preserveVersion(directory, previous)
		if err != nil {
			return "", err
		}
	}
	staging, err := os.MkdirTemp(directory, ".update-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(staging)
	for _, name := range names {
		if err := os.WriteFile(filepath.Join(staging, "new-"+name), components[name], 0755); err != nil {
			return "", err
		}
	}
	moved, installed := []string{}, []string{}
	restore := func(cause error) error {
		failures := []error{cause}
		for _, name := range installed {
			if err := os.Remove(filepath.Join(directory, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
				failures = append(failures, err)
			}
		}
		for _, name := range moved {
			if err := rename(filepath.Join(staging, "old-"+name), filepath.Join(directory, name)); err != nil {
				failures = append(failures, err)
			}
		}
		if previousErr == nil {
			failures = append(failures, os.WriteFile(filepath.Join(directory, ".launcher-version"), previousBytes, 0644))
		}
		return errors.Join(failures...)
	}
	for _, name := range names {
		destination := filepath.Join(directory, name)
		if _, err := os.Stat(destination); err == nil {
			if err := rename(destination, filepath.Join(staging, "old-"+name)); err != nil {
				return "", restore(err)
			}
			moved = append(moved, name)
		}
		if err := rename(filepath.Join(staging, "new-"+name), destination); err != nil {
			return "", restore(err)
		}
		installed = append(installed, name)
	}
	if rollback != "" {
		if err := os.WriteFile(filepath.Join(directory, ".previous-version"), []byte(previous+"\n"), 0644); err != nil {
			return "", restore(err)
		}
	}
	if err := os.WriteFile(filepath.Join(directory, ".launcher-version"), []byte(version+"\n"), 0644); err != nil {
		return "", restore(err)
	}
	return rollback, nil
}
