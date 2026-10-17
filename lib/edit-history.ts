export class EditHistory<T> {
  private past: T[] = [];
  private future: T[] = [];
  private group = "";
  private recordedAt = 0;
  constructor(private limit = 50) {}
  get counts() {
    return { undo: this.past.length, redo: this.future.length };
  }
  clear() {
    this.past = [];
    this.future = [];
    this.group = "";
  }
  record(value: T, group = "", now = Date.now()) {
    if (
      !group ||
      group !== this.group ||
      now - this.recordedAt > 800 ||
      this.future.length
    ) {
      this.past.push(value);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.group = group;
    this.recordedAt = now;
    this.future = [];
  }
  undo(current: T): T | undefined {
    if (!this.past.length) return;
    this.future.push(current);
    this.group = "";
    return this.past.pop();
  }
  redo(current: T): T | undefined {
    if (!this.future.length) return;
    this.past.push(current);
    this.group = "";
    return this.future.pop();
  }
}
