export const APP_NAME = 'Critical Path';

// Postgres caps a statement at 65,535 bind parameters and the item count per
// task or project is unbounded, so every path that copies or materialises
// checklist rows writes them in chunks rather than one insert that would 500
// partway through work it has already done.
export const CHECKLIST_INSERT_CHUNK = 5000;
