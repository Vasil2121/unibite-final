/* ===========================================================================
 * cron/unrated-penalty.js — ΠΕΡΙΟΔΙΚΗ ΕΡΓΑΣΙΑ: ΠΟΙΝΗ ΜΗ ΑΞΙΟΛΟΓΗΣΗΣ
 * -------------------------------------------------------------------------
 * ΤΙ ΚΑΝΕΙ
 *   Βρίσκει παραληφθέντα γεύματα που δεν βαθμολογήθηκαν μέσα σε 48 ώρες και
 *   αφαιρεί 1 πόντο από τον καταναλωτή.
 *
 * ΕΚΤΕΛΕΣΗ:  npm run cron:unrated
 *
 * ΔΙΠΛΗ ΑΣΦΑΛΕΙΑ ΚΑΤΑ ΤΗΣ ΔΙΠΛΗΣ ΧΡΕΩΣΗΣ
 *   1. Το query αποκλείει όσα έχουν ήδη εγγραφή 'unrated_penalty' (LEFT JOIN ...
 *      WHERE penalty.id IS NULL).
 *   2. Μέσα στο transaction ελέγχεται ΞΑΝΑ με hasUnratedPenalty().
 *   Ο δεύτερος έλεγχος υπάρχει γιατί ανάμεσα στο query και στην επεξεργασία
 *   μπορεί να μεσολαβήσει χρόνος ή δεύτερη εκτέλεση του script.
 *
 * ΚΑΘΕ ΑΙΤΗΜΑ ΕΧΕΙ ΔΙΚΟ ΤΟΥ TRANSACTION ΚΑΙ ΔΙΚΟ ΤΟΥ try/catch
 *   Αν ένα αποτύχει, τα υπόλοιπα συνεχίζουν κανονικά. Στο τέλος τυπώνεται
 *   σύνοψη (χρεώθηκαν / παραλείφθηκαν / σφάλματα) και ο κωδικός εξόδου είναι 1 αν
 *   υπήρξε έστω ένα σφάλμα — χρήσιμο για αυτοματοποίηση.
 *
 * ΠΑΡΑΛΕΙΨΗ ΜΕ ΜΗΔΕΝΙΚΟ ΥΠΟΛΟΙΠΟ
 *   Αν ο χρήστης έχει 0 πόντους, η addPoints επιστρέφει false (δεν επιτρέπουμε
 *   αρνητικό υπόλοιπο) και το αίτημα καταγράφεται ως "παραλείφθηκε".
 * =========================================================================
 */

import 'dotenv/config';
import pool, { withTransaction } from '../src/database/connection.js';
import * as requestsStore from '../src/store/requests-store.js';
import * as pointsStore from '../src/store/points-store.js';

const candidates = await requestsStore.findUnratedPastDeadline();

console.log(`Υποψήφια αιτήματα προς χρέωση: ${candidates.length}`);

let penalized = 0;
let skipped = 0;
let failed = 0;

for (const candidate of candidates) {
  try {
    const applied = await withTransaction(async function (conn) {
      const alreadyPenalized = await pointsStore.hasUnratedPenalty(conn, candidate.id);

      if (alreadyPenalized) {
        return false;
      }

      return pointsStore.addPoints(conn, candidate.consumerId, -1, 'unrated_penalty', candidate.id);
    });

    if (applied) {
      penalized += 1;
      console.log(`  Αίτημα ${candidate.id}: χρεώθηκε 1 πόντος στον χρήστη ${candidate.username}`);
    } else {
      skipped += 1;
      console.log(`  Αίτημα ${candidate.id}: παραλείφθηκε (μηδενικό υπόλοιπο ή ήδη χρεωμένο)`);
    }
  } catch (err) {
    failed += 1;
    console.error(`  Αίτημα ${candidate.id}: σφάλμα`, err);
  }
}

console.log(`Ολοκληρώθηκε. Χρεώθηκαν: ${penalized}, παραλείφθηκαν: ${skipped}, σφάλματα: ${failed}`);

await pool.end();
process.exit(failed > 0 ? 1 : 0);
