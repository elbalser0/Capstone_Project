import { unzipSync } from 'fflate';
import {
  IMPORT_TABLES,
  preparePreview,
  type ImportType,
  type Preview,
} from './importCsv';

export type ImportSelection = ImportType | 'zip';

interface ImportEntry {
  table: ImportType;
  file: File;
  preview: Preview;
}

export interface PreparedImport {
  filename: string;
  entries: ImportEntry[];
}

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

async function prepareEntry(table: ImportType, file: File): Promise<ImportEntry> {
  try {
    const preview = preparePreview(table, file.name, await file.text());
    return { table, file, preview };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read this CSV.';
    throw new Error(`${file.name}: ${message}`);
  }
}

export async function prepareImport(
  selection: ImportSelection,
  file: File,
): Promise<PreparedImport> {
  const extension = selection === 'zip' ? '.zip' : '.csv';
  if (!file.name.toLowerCase().endsWith(extension)) {
    throw new Error(`Choose a ${extension} file.`);
  }
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error('Choose a file no larger than 5 MB.');
  }

  if (selection !== 'zip') {
    return { filename: file.name, entries: [await prepareEntry(selection, file)] };
  }

  const paths = new Map<ImportType, string>();
  let expandedBytes = 0;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const extracted = unzipSync(bytes, {
    filter({ name, originalSize }) {
      if (name.endsWith('/')) return false;

      const filename = name.split('/').pop()?.toLowerCase();
      const table = IMPORT_TABLES.find((option) => filename === `${option}.csv`);

      if (!table) {
        if (filename?.endsWith('.csv')) {
          throw new Error(`${filename} is not supported in a Data ZIP.`);
        }
        return false;
      }

      if (paths.has(table)) {
        throw new Error(`The ZIP contains more than one ${table}.csv.`);
      }

      expandedBytes += originalSize;
      if (expandedBytes > MAX_IMPORT_BYTES) {
        throw new Error('The CSV files inside the ZIP must be under 5 MB combined.');
      }

      paths.set(table, name);
      return true;
    },
  });

  if (paths.size < 2) {
    throw new Error(
      'Include 2–7 supported CSV files in the ZIP. Use a CSV option for one file.',
    );
  }

  const includedTables = IMPORT_TABLES.filter((table) => paths.has(table));

  const csvFiles = includedTables.map((table) => {
    const path = paths.get(table)!;
    const csv = new File([new Uint8Array(extracted[path])], `${table}.csv`, {
      type: 'text/csv',
    });
    return { table, csv };
  });

  const totalSize = csvFiles.reduce((total, { csv }) => total + csv.size, 0);
  if (totalSize > MAX_IMPORT_BYTES) {
    throw new Error('The CSV files inside the ZIP must be under 5 MB combined.');
  }

  const entries = await Promise.all(
    csvFiles.map(({ table, csv }) => prepareEntry(table, csv)),
  );
  return { filename: file.name, entries };
}