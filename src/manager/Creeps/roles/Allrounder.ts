import { Build } from "../jobs/Build";
import { Gather } from "../jobs/Gather";
import { Harvest } from "../jobs/Harvest";
import { Haul } from "../jobs/Haul";
import { Job } from "../jobs/Job";
import { Mine } from "../jobs/Mine";
import { Repair } from "../jobs/Repair";
import { Upgrade } from "../jobs/Upgrade";



export class Allrounder {
    public creep: Creep;
    public jobs: any = {Repair, Upgrade, Mine, Gather, Haul, Build, Harvest};
    public job: typeof Job | undefined ;
    constructor(creep: Creep) {
        this.creep = creep;
        if(creep.memory.job !== undefined ){
            if(this.jobs[this.creep.memory.job] !== undefined ){
                this.job = new this.jobs[this.creep.memory.job](this.creep);
            } else {
                throw new Error("Creep: " +  this.creep.name + " has wrong Job!");
            }
        }       
    }

    public run(): void {
        if(this.job === undefined ) {
            // Why is this here ? Memory Cleanup ?
            /*
            if (this.creep.room.controller!.level > 2){
                this.repairCancel(this.creep);
                this.upgradeCancel(this.creep);
        
            }
            this.mineCancel(this.creep);
            this.gatherCancel(this.creep);
            */
            if(this.creep.room.controller!.level <= 2 && this.creep.room.controller!.ticksToDowngrade < 1000){
                this.setJob("Upgrade");
            }
            this.setJob("Haul");  
            this.setJob("Build");
            if (this.creep.room.controller!.level <= 2){
                this.setJob("Repair");
                this.setJob("Upgrade");
            }
            this.setJob("Salvage");
            this.setJob("Harvest");
        } else {
            if(this.job !== undefined){
                this.job.run(this.creep);
            }
        }
    }

    public setJob(j: string): void {
        this.job = new this.jobs[j](this.creep);
    }
}