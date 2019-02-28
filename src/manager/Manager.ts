import { Config } from "./Config";

export class Manager<T extends Config> {
    protected config: T;
    constructor(type : new(...args : any[]) => T, ...args: any[]) {
        this.config = new type(...args);
    }
    
    public destroy(): void {
        this.config.saveConfig();
    }
}