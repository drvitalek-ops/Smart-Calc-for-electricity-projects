package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func seededInstall(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for _, name := range installedComponents {
		if err := os.WriteFile(filepath.Join(root, name), []byte("old-"+name), 0755); err != nil {
			t.Fatal(err)
		}
	}
	os.WriteFile(filepath.Join(root, ".launcher-version"), []byte("1.0.42\n"), 0644)
	return root
}
func replacements() map[string][]byte {
	return map[string][]byte{"SmartHomeCalc.Backend.exe": []byte("new backend"), "SmartHomeCalc.Desktop.exe": []byte("new desktop")}
}
func requireOld(t *testing.T, root string) {
	t.Helper()
	for _, name := range installedComponents {
		value, _ := os.ReadFile(filepath.Join(root, name))
		if string(value) != "old-"+name {
			t.Fatalf("old pair was not restored: %s", name)
		}
	}
	version, _ := os.ReadFile(filepath.Join(root, ".launcher-version"))
	if strings.TrimSpace(string(version)) != "1.0.42" {
		t.Fatal("old version marker was not restored")
	}
}
func TestUpgradeKeepsRunnablePreviousPair(t *testing.T) {
	root := seededInstall(t)
	rollback, err := installVersion(root, "1.0.43", replacements())
	if err != nil {
		t.Fatal(err)
	}
	if rollback != filepath.Join(root, "rollback", "v1.0.42") {
		t.Fatal(rollback)
	}
	for _, name := range installedComponents {
		old, _ := os.ReadFile(filepath.Join(rollback, name))
		if string(old) != "old-"+name {
			t.Fatalf("invalid saved component %s", name)
		}
		current, _ := os.ReadFile(filepath.Join(root, name))
		if string(current) == string(old) {
			t.Fatal("new executable not installed")
		}
	}
	if needsInstall(root, "1.0.43") {
		t.Fatal("a complete install should not be extracted again")
	}
	if !regularFile(filepath.Join(rollback, "Start-previous-version.cmd")) {
		t.Fatal("no offline rollback entry point")
	}
}
func TestFailedReplacementRestoresOldPair(t *testing.T) {
	root := seededInstall(t)
	injected := false
	rename := func(a, b string) error {
		if !injected && strings.HasPrefix(filepath.Base(a), "new-") && strings.HasSuffix(b, "SmartHomeCalc.Desktop.exe") {
			injected = true
			return errors.New("simulated antivirus lock")
		}
		return os.Rename(a, b)
	}
	if _, err := installVersionWithRename(root, "1.0.43", replacements(), rename); err == nil {
		t.Fatal("expected replacement failure")
	}
	requireOld(t, root)
}
func TestUnknownVersionAndDirectoryTargetsDoNotTouchOldFiles(t *testing.T) {
	root := seededInstall(t)
	if _, err := installVersion(root, "../../other", replacements()); err == nil {
		t.Fatal("invalid version accepted")
	}
	requireOld(t, root)
	path := filepath.Join(root, "SmartHomeCalc.Desktop.exe")
	os.Remove(path)
	os.Mkdir(path, 0755)
	if _, err := installVersion(root, "1.0.43", replacements()); err == nil {
		t.Fatal("directory target accepted")
	}
	value, _ := os.ReadFile(filepath.Join(root, "SmartHomeCalc.Backend.exe"))
	if string(value) != "old-SmartHomeCalc.Backend.exe" {
		t.Fatal("unrelated component changed")
	}
}
func TestExistingRollbackCopyRemainsUnchanged(t *testing.T) {
	root := seededInstall(t)
	saved, err := preserveVersion(root, "1.0.42")
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(root, "SmartHomeCalc.Backend.exe"), []byte("changed"), 0755)
	again, err := preserveVersion(root, "1.0.42")
	if err != nil || again != saved {
		t.Fatal(err)
	}
	value, _ := os.ReadFile(filepath.Join(saved, "SmartHomeCalc.Backend.exe"))
	if string(value) != "old-SmartHomeCalc.Backend.exe" {
		t.Fatal("rollback copy was overwritten")
	}
}
