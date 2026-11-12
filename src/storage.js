const KEY = "mona-crossing:v1";
const DEFAULTS = Object.freeze({ best: 0, sound: false, relaxed: false });

export function createStorage(storage, report) {
  let available = true;
  function unavailable(error) {
    if (available) {
      available = false;
      console.warn("Mona Crossing cannot use local storage:", error);
      report("Local saves are unavailable. Your best score and settings last only this visit. Allow site storage to save them.");
    }
  }
  return {
    load() {
      try {
        const raw = storage.getItem(KEY);
        if (!raw) return { ...DEFAULTS };
        const data = JSON.parse(raw);
        // `relaxed` arrived after the first saves shipped; older records omit it and keep the standard timer.
        if (!data || !Number.isSafeInteger(data.best) || data.best < 0 || typeof data.sound !== "boolean"
          || (data.relaxed !== undefined && typeof data.relaxed !== "boolean")) {
          throw new Error("Saved data is invalid");
        }
        return { best: data.best, sound: data.sound, relaxed: data.relaxed === true };
      } catch (error) {
        unavailable(error);
        return { ...DEFAULTS };
      }
    },
    save(data) {
      if (!available) return;
      try { storage.setItem(KEY, JSON.stringify(data)); }
      catch (error) { unavailable(error); }
    }
  };
}
