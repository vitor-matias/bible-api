import fs from 'fs/promises'
import * as usfm from 'usfm-js'

/**
 * Takes the file on the path and reads it in to memory
 * @param path 
 * @returns 
 */
export const readBook = async (path: string): Promise<USFMBook> => {
    try {
        const usfmContent = await fs.readFile(path, 'utf8');
        const parsedData = usfm.toJSON(usfmContent);
        return parsedData;
    } catch (err) {
        console.error(err)
        throw err;
    }
  }