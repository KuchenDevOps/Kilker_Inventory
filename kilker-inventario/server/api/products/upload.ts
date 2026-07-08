import { readMultipartFormData } from 'h3';
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { categories, products, productUnit } from '../../db/schema'

import Papa from 'papaparse';

export default defineEventHandler(async (event) => {
  const formData = await readMultipartFormData(event);
  
  if (!formData) {
    throw createError({ statusCode: 400, statusMessage: 'No file uploaded' });
  }

  // Find the file in the form data
  const fileField = formData.find((f) => f.name === 'csvFile');
  if (!fileField) {
    throw createError({ statusCode: 400, statusMessage: 'File field missing' });
  }

  // Convert the buffer to a string
  const csvString = fileField.data.toString('utf-8');

  // Parse CSV to JSON
  const parsedData = Papa.parse(csvString, {
    header: true,
    skipEmptyLines: true,
  });

  // Do whatever you need with parsedData.data here (e.g., save to db, forward to another API)

  return {
    success: true,
    message: 'CSV imported and parsed successfully',
    data: parsedData.data,
  };
});
