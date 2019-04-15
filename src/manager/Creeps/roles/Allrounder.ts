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
    public job: Job | undefined ;
    constructor(creep: Creep) {
        this.creep = creep;
        if(creep.memory.job !== undefined ){
            if(this.jobs[this.creep.memory.job] !== undefined ){
                this.job = new this.jobs[j](this.creep) as Job;
            } else {
                throw new Error("Creep: " +  this.creep.name + " has wrong Job!");
            }
        }       
    }

    public run(): void {
        if(this.creep.memory.job === undefined ) {
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
        } else {

        }
    }

    public setJob(j: string): void {
        this.job = new this.jobs[j](this.creep) as Job;
    }
}