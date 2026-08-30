import path from 'node:path';
import process from 'node:process';

export interface OutputFormatSuffix<Format extends string> {
  readonly format: Format;
  readonly suffix: string;
  readonly message?: string;
}

export interface PositiveOutputSelection<Format extends string> {
  readonly format: Format;
  readonly path: string;
}

export interface PositiveOutputSelectionOptions<Format extends string> {
  readonly filenames: readonly string[];
  readonly formats: readonly OutputFormatSuffix<Format>[];
  readonly baseDirectory?: string;
}

const pathKey = (selectedPath: string): string =>
  process.platform === 'win32' ? selectedPath.toLowerCase() : selectedPath;

export const selectOutputFormatBySuffix = <Format extends string>(
  filename: string,
  formats: readonly OutputFormatSuffix<Format>[],
): Format => {
  const lower = filename.toLowerCase();
  const matches = formats
    .filter(({ suffix }) => lower.endsWith(suffix.toLowerCase()))
    .sort((left, right) => right.suffix.length - left.suffix.length);
  const match = matches[0];
  if (match === undefined) {
    throw new Error(`output path has no recognized format suffix: ${filename}`);
  }
  if (match.message !== undefined) throw new Error(match.message);
  return match.format;
};

export const validatePositiveOutputSelections = <Format extends string>({
  filenames,
  formats,
  baseDirectory = process.cwd(),
}: PositiveOutputSelectionOptions<Format>): readonly PositiveOutputSelection<Format>[] => {
  const selectedFormats = new Set<Format>();
  const selectedPaths = new Set<string>();
  return Object.freeze(
    filenames.map((filename) => {
      const format = selectOutputFormatBySuffix(filename, formats);
      if (selectedFormats.has(format)) {
        throw new Error(`output format is repeated: ${format}`);
      }
      selectedFormats.add(format);
      const selectedPath = path.resolve(baseDirectory, filename);
      const key = pathKey(selectedPath);
      if (selectedPaths.has(key)) {
        throw new Error(`output path is repeated: ${filename}`);
      }
      selectedPaths.add(key);
      return Object.freeze({ format, path: selectedPath });
    }),
  );
};
