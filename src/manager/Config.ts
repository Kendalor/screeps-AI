import { Manager } from "./Manager";

interface ConfigMemory {
    changed: number;
    saveConfig(): void;
}

export class Config implements ConfigMemory{
    public changed: number;

    constructor() {
        this.changed = Game.time;
    }

    public saveConfig(): void {
        // TO Implement
    }
}