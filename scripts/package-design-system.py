"""Package the offline preview, tokens and reference sources for a release."""
import argparse
import shutil
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / 'design-system/smart-home-calc'


def package(output):
    preview = PROFILE / 'preview.html'
    if not preview.exists():
        raise SystemExit('Сначала выполните npm run design-system:preview --prefix frontend')
    output.mkdir(parents=True, exist_ok=True)
    html = output / 'SmartHomeCalc-Design-System.html'
    shutil.copy2(preview, html)
    paths = [*PROFILE.glob('*.md'), PROFILE/'tokens.json', *PROFILE.glob('pages/*.md'),
             *ROOT.glob('frontend/src/ui/*'), *ROOT.glob('frontend/src/design-system/*'),
             ROOT/'scripts/build-design-tokens.py', ROOT/'frontend/build-design-system.mjs']
    archive = output / 'SmartHomeCalc-Design-System.zip'
    with ZipFile(archive, 'w', compression=ZIP_DEFLATED) as bundle:
        bundle.write(preview, html.name)
        for path in sorted(set(paths)):
            if path.is_file():
                bundle.write(path, path.relative_to(ROOT).as_posix())
        bundle.writestr('README.txt',
            'Smart Home Calc — дизайн-система 1.0\n\n'
            'Откройте SmartHomeCalc-Design-System.html в браузере. Интернет и установка не нужны.\n'
            'Внутри образца можно скачать JSON и CSS токенов.\n'
            'Правила: design-system/smart-home-calc/MASTER.md и pages/.\n'
            'В архив также включены исходники общих компонентов и компилятор токенов.\n'
            'Для пересборки образца используйте полный репозиторий приложения:\n'
            'https://github.com/drvitalek-ops/Smart-Calc-for-electricity-projects\n')
    print(html)
    print(archive)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', type=Path, default=ROOT/'release')
    package(parser.parse_args().output_dir.resolve())
