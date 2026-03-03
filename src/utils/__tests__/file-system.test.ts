import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDirectory,
  deleteDirectory,
  deleteFile,
  fileExists,
  readFile,
  readJsonFile,
  writeBinaryFile,
  writeFile,
  writeJsonFile,
} from '../file-system.ts';

const mockFs = vi.hoisted(() => ({
  access: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
  rm: vi.fn(),
}));

vi.mock('fs', () => ({
  promises: mockFs,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// fileExists
// ---------------------------------------------------------------------------

describe('fileExists', () => {
  it('powinien zwrócić true gdy plik istnieje', async () => {
    mockFs.access.mockResolvedValue(undefined);

    expect(await fileExists('/some/file.txt')).toBe(true);
    expect(mockFs.access).toHaveBeenCalledWith('/some/file.txt');
  });

  it('powinien zwrócić false gdy plik nie istnieje (ENOENT)', async () => {
    mockFs.access.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    expect(await fileExists('/missing/file.txt')).toBe(false);
  });

  it('powinien zwrócić false dla dowolnego błędu dostępu', async () => {
    mockFs.access.mockRejectedValue(new Error('Permission denied'));

    expect(await fileExists('/protected/file.txt')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// readFile
// ---------------------------------------------------------------------------

describe('readFile', () => {
  it('powinien zwrócić zawartość pliku jako string', async () => {
    mockFs.readFile.mockResolvedValue('zawartość pliku');

    expect(await readFile('/some/file.txt')).toBe('zawartość pliku');
    expect(mockFs.readFile).toHaveBeenCalledWith('/some/file.txt', 'utf-8');
  });

  it('powinien rzucić błąd gdy plik nie istnieje', async () => {
    mockFs.readFile.mockRejectedValue(new Error('ENOENT: no such file'));

    await expect(readFile('/missing/file.txt')).rejects.toThrow('ENOENT: no such file');
  });
});

// ---------------------------------------------------------------------------
// writeFile
// ---------------------------------------------------------------------------

describe('writeFile', () => {
  it('powinien utworzyć katalog nadrzędny i zapisać plik', async () => {
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);

    await writeFile('/output/subdir/file.txt', 'treść');

    expect(mockFs.mkdir).toHaveBeenCalledWith('/output/subdir', { recursive: true });
    expect(mockFs.writeFile).toHaveBeenCalledWith('/output/subdir/file.txt', 'treść', {
      encoding: 'utf-8',
      mode: undefined,
    });
  });

  it('powinien przekazać mode do writeFile gdy podano uprawnienia', async () => {
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);

    await writeFile('/secure/tokens.json', '{}', 0o600);

    expect(mockFs.writeFile).toHaveBeenCalledWith('/secure/tokens.json', '{}', { encoding: 'utf-8', mode: 0o600 });
  });
});

// ---------------------------------------------------------------------------
// writeBinaryFile
// ---------------------------------------------------------------------------

describe('writeBinaryFile', () => {
  it('powinien utworzyć katalog nadrzędny i zapisać dane binarne', async () => {
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);

    const data = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    await writeBinaryFile('/output/archive.zip', data);

    expect(mockFs.mkdir).toHaveBeenCalledWith('/output', { recursive: true });
    expect(mockFs.writeFile).toHaveBeenCalledWith('/output/archive.zip', data);
  });
});

// ---------------------------------------------------------------------------
// deleteFile
// ---------------------------------------------------------------------------

describe('deleteFile', () => {
  it('powinien usunąć plik wywołując unlink', async () => {
    mockFs.unlink.mockResolvedValue(undefined);

    await deleteFile('/some/file.txt');

    expect(mockFs.unlink).toHaveBeenCalledWith('/some/file.txt');
  });

  it('powinien cicho zignorować błąd ENOENT gdy plik nie istnieje', async () => {
    mockFs.unlink.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    await expect(deleteFile('/missing/file.txt')).resolves.toBeUndefined();
  });

  it('powinien rzucić błąd dla innych błędów niż ENOENT', async () => {
    mockFs.unlink.mockRejectedValue(Object.assign(new Error('Permission denied'), { code: 'EACCES' }));

    await expect(deleteFile('/protected/file.txt')).rejects.toThrow('Permission denied');
  });
});

// ---------------------------------------------------------------------------
// deleteDirectory
// ---------------------------------------------------------------------------

describe('deleteDirectory', () => {
  it('powinien usunąć katalog rekursywnie', async () => {
    mockFs.rm.mockResolvedValue(undefined);

    await deleteDirectory('/output/tmp');

    expect(mockFs.rm).toHaveBeenCalledWith('/output/tmp', { recursive: true, force: true });
  });

  it('powinien cicho zignorować błąd ENOENT gdy katalog nie istnieje', async () => {
    mockFs.rm.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    await expect(deleteDirectory('/missing/dir')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createDirectory
// ---------------------------------------------------------------------------

describe('createDirectory', () => {
  it('powinien utworzyć katalog z opcją recursive', async () => {
    mockFs.mkdir.mockResolvedValue(undefined);

    await createDirectory('/output/new/nested/dir');

    expect(mockFs.mkdir).toHaveBeenCalledWith('/output/new/nested/dir', { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// readJsonFile
// ---------------------------------------------------------------------------

describe('readJsonFile', () => {
  it('powinien wczytać i sparsować poprawny plik JSON', async () => {
    mockFs.readFile.mockResolvedValue('{"key": "value", "num": 42}');

    const result = await readJsonFile('/config/settings.json');

    expect(result).toEqual({ key: 'value', num: 42 });
  });

  it('powinien rzucić błąd gdy zawartość pliku nie jest poprawnym JSON', async () => {
    mockFs.readFile.mockResolvedValue('to nie jest json { broken');

    await expect(readJsonFile('/config/broken.json')).rejects.toThrow(SyntaxError);
  });

  it('powinien rzucić błąd gdy plik nie istnieje', async () => {
    mockFs.readFile.mockRejectedValue(new Error('ENOENT: no such file'));

    await expect(readJsonFile('/missing/file.json')).rejects.toThrow('ENOENT');
  });
});

// ---------------------------------------------------------------------------
// writeJsonFile
// ---------------------------------------------------------------------------

describe('writeJsonFile', () => {
  it('powinien serializować obiekt do JSON z wcięciami i zapisać plik', async () => {
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);

    await writeJsonFile('/output/data.json', { key: 'value', num: 42 });

    expect(mockFs.writeFile).toHaveBeenCalledWith(
      '/output/data.json',
      JSON.stringify({ key: 'value', num: 42 }, null, 2),
      { encoding: 'utf-8', mode: undefined },
    );
  });

  it('powinien przekazać mode do pliku gdy podano uprawnienia', async () => {
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);

    await writeJsonFile('/secure/tokens.json', { token: 'abc' }, 0o600);

    expect(mockFs.writeFile).toHaveBeenCalledWith('/secure/tokens.json', JSON.stringify({ token: 'abc' }, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  });
});
