export class Allrounder {
    public creep: Creep;

    constructor(creep: Creep) {
        this.creep = creep;
    }

    public run(): void {
        if (this.creep.room.controller!.level > 2){
        this.repairCancel(this.creep);
        this.upgradeCancel(this.creep);

        }
        this.mineCancel(this.creep);
        this.gatherCancel(this.creep);

        if(this.creep.room.controller!.level <= 2 && this.creep.room.controller!.ticksToDowngrade < 1000){
            this.upgrade(this.creep);
        }
        this.haul(this.creep);  
        this.build(this.creep);
        if (this.creep.room.controller!.level <= 2){
            this.repair(this.creep);
            this.upgrade(this.creep);
        }
        this.salvage(this.creep);
        this.harvest(this.creep);
    }
}