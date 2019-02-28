import { Manager } from "manager/Manager";
import { SourceConfig } from "./SourceConfig";

export class SourceManager extends Manager<SourceConfig> {
    private source: Source |null;
    constructor( source: string) {
        super(SourceConfig);
        this.source = Game.getObjectById(source);
    }

    public run(): void {
        console.log("Running Source Manager for Source with id: " + this.source);
        // TODO
        
    }

}