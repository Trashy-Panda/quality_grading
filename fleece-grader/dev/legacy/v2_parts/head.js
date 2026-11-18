// omr.js - in-browser reader for the wool grading sheet. Requires OpenCV.js (loaded lazily from a pinned CDN).
// v2: the sheet is registered on its ruled table lines (grid.js), not on the faint bubble outlines. See SPEC.md.
import { GRID } from './template.js';
import { findLattice, bubbles } from './grid.js';

export const FIELDS = ['grade', 'length', 'yieldTens', 'yieldOnes', 'purity', 'character'];
export const OPENCV_URL = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js';
const TEMPLATE = { aspect: 0.75, paperFallback: { l: 0.13, t: 0.155, r: 0.14, b: 0.055 } }; // only for the rough table search
const WORK_EDGE = 2000, MAX_SRC_EDGE = 3200;

