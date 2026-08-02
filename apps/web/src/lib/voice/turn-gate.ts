type OrderedVoiceEvent = { sessionId: string; turnId: number; sequence: number };

export class TurnGate {
  private activeSessionId: string | null = null;
  private activeTurnId = 0;
  private lastSequenceByTurn = new Map<number, number>();
  private dropped = 0;

  start(sessionId: string, turnId = 0): void {
    this.activeSessionId = sessionId;
    this.activeTurnId = turnId;
    this.lastSequenceByTurn.clear();
    this.dropped = 0;
  }

  moveToTurn(turnId: number): void {
    if (turnId < this.activeTurnId) return;
    this.activeTurnId = turnId;
  }

  cancelAndAdvance(): number {
    this.activeTurnId += 1;
    return this.activeTurnId;
  }

  accept(event: OrderedVoiceEvent): boolean {
    if (event.sessionId !== this.activeSessionId || event.turnId !== this.activeTurnId) {
      this.dropped += 1;
      return false;
    }
    const lastSequence = this.lastSequenceByTurn.get(event.turnId) ?? -1;
    if (!Number.isSafeInteger(event.sequence) || event.sequence <= lastSequence) {
      this.dropped += 1;
      return false;
    }
    this.lastSequenceByTurn.set(event.turnId, event.sequence);
    return true;
  }

  get sessionId(): string | null {
    return this.activeSessionId;
  }

  get turnId(): number {
    return this.activeTurnId;
  }

  get droppedEvents(): number {
    return this.dropped;
  }
}
