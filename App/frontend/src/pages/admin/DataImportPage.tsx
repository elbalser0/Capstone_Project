import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { ImportResult } from '../../api/types';
import { Button } from '../../components/ui';
import { COLUMNS, IMPORT_TABLES, type Preview } from '../../lib/importCsv';
import {
  prepareImport,
  type ImportSelection,
  type PreparedImport,
} from '../../lib/importFiles';

const OPTIONS = [...IMPORT_TABLES, 'zip'] as const;

const LABELS: Record<ImportSelection, string> = {
  department: 'Department',
  term: 'Term ',
  professor: 'Professor',
  ac_member: 'AC Member',
  course: 'Course',
  section: 'Section',
  meeting_time: 'Meeting Time',
  zip: 'Data ZIP',
};

function CsvPreview({ preview }: { preview: Preview }) {
  return (
    <section className="mt-6">
      <h3 className="break-all font-semibold">{preview.filename}</h3>
      <div className="mt-2 max-h-[420px] overflow-auto rounded-md border border-gray-200">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Preview of {preview.filename}</caption>
          <thead className="sticky top-0 bg-gray-50">
            <tr>
              {preview.headers.map((header) => (
                <th key={header} scope="col" className="whitespace-nowrap border-b px-3 py-3">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.slice(0, 20).map((row, index) => (
              <tr key={index} className="border-b last:border-b-0">
                {row.map((cell, column) => (
                  <td key={column} className="px-3 py-3">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm text-gray-500">
        Showing {Math.min(20, preview.rows.length)} of {preview.rows.length} rows.
      </p>
    </section>
  );
}

export function DataImportPage() {
  const queryClient = useQueryClient();
  const [type, setType] = useState<ImportSelection>('section');
  const [selection, setSelection] = useState<PreparedImport | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [reading, setReading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const readVersion = useRef(0);
  const submittingRef = useRef(false);

  function changeType(next: ImportSelection) {
    if (submittingRef.current) return;
    readVersion.current += 1;
    setType(next);
    setSelection(null);
    setShowPreview(false);
    setReading(false);
    setError('');
    setResult(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function chooseFile(file: File) {
    if (submittingRef.current) return;
    const version = ++readVersion.current;
    setSelection(null);
    setShowPreview(false);
    setError('');
    setReading(true);

    try {
      const prepared = await prepareImport(type, file);
      if (version === readVersion.current) setSelection(prepared);
    } catch (caught) {
      if (version === readVersion.current) {
        setError(caught instanceof Error ? caught.message : 'Could not read the file.');
      }
    } finally {
      if (version === readVersion.current) setReading(false);
    }
  }

  async function submitImport() {
    if (!selection || reading || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError('');

    try {
      const form = new FormData();
      for (const { table, file } of selection.entries) {
        form.append(table, file, `${table}.csv`);
      }

      const response = await api<ImportResult>('/admin/import', {
        method: 'POST',
        body: form,
      });

      for (const { table } of selection.entries) {
        const imported = response?.imported?.[table];
        const skipped = response?.skipped?.[table];

        if (
          typeof imported !== 'number' || !Number.isInteger(imported) || imported < 0 ||
          typeof skipped !== 'number' || !Number.isInteger(skipped) || skipped < 0
        ) {
          throw new Error('The import response did not include valid record counts.');
        }
      }

      setResult(response);
      void queryClient.invalidateQueries();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not import the file.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const submitButton = (
    <Button
      type="button"
      disabled={!selection || reading || submitting}
      onClick={() => void submitImport()}
    >
      {submitting ? 'Importing...' : 'Submit'}
    </Button>
  );

  const errorMessage = error && (
    <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>
  );

  if (result && selection) {
    return (
      <section aria-label="Import result" className="py-20 text-center">
        <div role="status">
          <h2 className="text-2xl font-bold">Import complete</h2>
          <p className="mt-2 break-all text-sm text-gray-500">{selection.filename}</p>
          <ul className="mt-4 space-y-2 text-sm">
            {selection.entries.map(({ table }) => (
              <li key={table}>
                {LABELS[table]}: {result.imported[table]} imported,{' '}
                {result.updated?.[table] ?? 0} updated,{' '}
                {result.skipped[table]} skipped
              </li>
            ))}
          </ul>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="mt-6"
          onClick={() => changeType(type)}
        >
          Back to Data Import
        </Button>
      </section>
    );
  }

  if (showPreview && selection) {
    return (
      <section aria-label="Preview import" aria-busy={submitting}>
        <h2 className="text-xl font-bold">Preview {LABELS[type]}</h2>
        {type === 'zip' && (
          <p className="mt-2 break-all text-sm text-gray-500">{selection.filename}</p>
        )}
        {selection.entries.map(({ table, preview }) => (
          <CsvPreview key={table} preview={preview} />
        ))}
        {errorMessage}
        <div className="mt-6 flex justify-between">
          <Button
            type="button"
            variant="secondary"
            disabled={submitting}
            onClick={() => setShowPreview(false)}
          >
            Back
          </Button>
          {submitButton}
        </div>
      </section>
    );
  }

  const isZip = type === 'zip';

  return (
    <section aria-label="Data import" aria-busy={reading || submitting}>
      <h2 className="text-lg font-bold">Upload new data</h2>

      <fieldset className="mt-3" disabled={submitting}>
        <legend className="mb-3 text-sm text-gray-500">
          Choose the type of data to import.
        </legend>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {OPTIONS.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="import-type"
                checked={type === option}
                onChange={() => changeType(option)}
                className="accent-orange-700"
              />
              {LABELS[option]}
            </label>
          ))}
        </div>
      </fieldset>

      <input
        ref={fileInput}
        type="file"
        accept={isZip ? '.zip,application/zip' : '.csv,text/csv'}
        aria-label={isZip ? 'Choose a ZIP file' : 'Choose a CSV file'}
        className="hidden"
        disabled={reading || submitting}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void chooseFile(file);
        }}
      />

      <div className="mt-6 rounded-md border border-gray-200 bg-gray-50 px-6 py-10 text-center">
        {reading ? (
          <p role="status" className="text-sm text-gray-600">Reading your file...</p>
        ) : selection ? (
          <>
            <button
              type="button"
              disabled={submitting}
              className="break-all font-semibold text-blue-600 underline"
              onClick={() => setShowPreview(true)}
            >
              {selection.filename}
            </button>
            <p className="mt-2 text-sm text-gray-500">Click the filename to preview.</p>
          </>
        ) : (
          <p className="text-sm text-gray-600">
            {isZip
              ? 'Include 2–7 CSV files: department.csv, term.csv, professor.csv, ac_member.csv, course.csv, section.csv, or meeting_time.csv.'
              : `Choose a file for ${LABELS[type]}.`}
          </p>
        )}
        <Button
          type="button"
          variant="secondary"
          className="mt-4"
          disabled={reading || submitting}
          onClick={() => fileInput.current?.click()}
        >
          {selection ? 'Replace file' : 'Choose file'}
        </Button>
      </div>

      {(isZip || type === 'course' || type === 'section') && (
        <p className="mt-3 text-sm text-gray-500">
          Referenced departments and professors must already exist.
        </p>
      )}

      <details className="mt-4 text-sm text-gray-600">
        <summary className="cursor-pointer">Required CSV columns</summary>
        {(type === 'zip' ? IMPORT_TABLES : [type]).map((table) => (
          <p key={table} className="mt-2 break-words font-mono">
            {table}.csv: {COLUMNS[table].join(', ')}
          </p>
        ))}
      </details>

      {errorMessage}
      <div className="mt-6 flex justify-end">{submitButton}</div>
    </section>
  );
}