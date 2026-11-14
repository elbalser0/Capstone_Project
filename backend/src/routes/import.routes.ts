import { Router } from 'express';
import { ApiError } from '../middleware/error.middleware.js';
import { IMPORT_TABLES, importData, type ImportFiles, type ImportTable } from '../services/import.service.js';
import { readMultipart } from './multipart.js';

// Mounted at /api/admin/import after authenticate and requireAdmin.
export const importRouter = Router();

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const invalid = (message: string) => new ApiError(400, 'INVALID_IMPORT', message);

// Form fields are the table names, each one CSV file, like Scripts/seed_data.
importRouter.post('/', async (req, res) => {
  if (!req.is('multipart/form-data')) throw invalid('Send the CSV files as form data, one field per table.');
  const form = await readMultipart(req, MAX_IMPORT_BYTES,
    () => new ApiError(413, 'TOO_LARGE', 'The files can be up to 5 MB together.'),
    () => invalid('The form data could not be read.'));
  const files: ImportFiles = {};
  for (const [name, value] of form.entries()) {
    if (name === 'professor' || name === 'department') {
      throw invalid(`${name}.csv is not imported here. Add ${name}s on the admin page.`);
    }
    if (!IMPORT_TABLES.includes(name as ImportTable)) {
      throw invalid(`Unknown file ${name}. Send term, course, section or meeting_time.`);
    }
    if (typeof value === 'string') throw invalid(`${name} must be a CSV file.`);
    if (files[name as ImportTable] !== undefined) throw invalid(`${name} was sent twice.`);
    files[name as ImportTable] = await value.text();
  }
  if (Object.keys(files).length === 0) throw invalid('Send at least one CSV file.');
  res.status(200).json(await importData(files));
});
