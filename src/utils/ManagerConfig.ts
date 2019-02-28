abstract class ManagerConfig {

    constructor(){
        // TODO
    }

    public changed: boolean = false;
    
    abstract save(): void;

    public destroy(): void {
        if(this.changed) {
            this.save();
        }
    }

    abstract init(): void;

    abstract load(): void;

    abstract validate(): void;
}