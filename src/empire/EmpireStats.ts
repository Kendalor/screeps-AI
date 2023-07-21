import { EmpireManager } from "./EmpireManager";

export class EmpireStats {
    public empire: EmpireManager;
    private memory: any;
    private roles: any = {};
    private ops: any = {};

    constructor(empire: EmpireManager){
        this.empire=empire;
        this.memory = Memory.stats;
    }
    public init(): void {
        this.memory = {};
        this.roles = {};
        this.ops = {};
    }


    public run(): void {
        this.cpuStats();
        this.gclStats();
        this.countCreeps();
        this.countOps();
        // TODO
    }

    private updateCpuUsed(): void {
        this.memory.cpuUsed=Game.cpu.getUsed();
    }

    private cpuStats(): void {
        if(this.memory.cpu == null){
            this.memory.cpu = {}; 
        }
        this.memory.cpu.limit = Game.cpu.limit;
        this.memory.cpu.tickLimit = Game.cpu.tickLimit;
        this.memory.cpu.bucket = Game.cpu.bucket;
    }

    private gclStats(): void {
        this.memory.gcl = Game.gcl;
        this.memory.gpl = Game.gpl;
    }

    public destroy(): void {
        this.updateCpuUsed();
        this.reduceCreeps();
        this.reduceOps();
        Memory.stats = this.memory;
    }

    public addCreep(cpu: number, role: string){
        if(this.roles[role] == null){
            this.roles[role] = [];
        }
        this.roles[role].push(cpu);

    }

    public addOp(cpu: number, op: OPERATION) {
        if(this.ops[op] == null){
            this.ops[op] = [];
        }
        this.ops[op].push(cpu);
    }

    public countOps(){
        this.memory.numOps =this.empire.opMgr.getOpCount();
    }

    public countCreeps(){
        this.memory.numCreeps = Object.keys(Game.creeps).length;
    }

    public reduceCreeps(): void {
        this.memory.roles = {};
        for(const key of Object.keys(this.roles)){
            this.memory.roles[key] = this.average(this.roles[key]);
        }
    }
    public reduceOps(): void {
        this.memory.ops = {};

        for(const key of Object.keys(this.ops)){
            this.memory.ops[key] = this.average(this.ops[key]);
        }
    }

    public average(list: number[]): number {
        let sum = 0;
        for( const i of list){
            sum += i;
        }
        return sum/ list.length;
    }



}