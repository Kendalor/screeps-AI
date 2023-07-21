import { CreepManager } from "empire/CreepManager";
import { RoomMemoryUtil } from "utils/RoomMemoryUtil";
import { EmpireStats } from "./EmpireStats";
import { ColonizeOperation } from "./operations/expansion/ColonizeOperation";
import { InitialRoomOperation } from "./operations/Operations/InitialBuildUpPhase/InitRoomOperation";
import { OperationsManager } from "./OperationsManager";
import { SpawnManager } from "./SpawnManager";


export class EmpireManager implements IEmpireManager {
    public opMgr: IOperationsManager;
    public creepMgr: ICreepManager;
    public spawnMgr: ISpawnManager;
    public stats: EmpireStats;
    private data: any;
    private memory: IEmpireMemory;
    private baseOps: InitialRoomOperation[] | undefined;
    public memoryVersion: number = 4;



    constructor(){
        if(Memory.empire == null){
            Memory.empire= {toSpawnList: {}, operations: {}, data: {}, myRooms: {}, memoryVersion: this.memoryVersion} ;
        }
        this.stats = new EmpireStats(this);
       this.opMgr = new OperationsManager(this);
       this.creepMgr = new CreepManager(this);
       this.spawnMgr = new SpawnManager(this);
       if(Memory.empire.memoryVersion != null){
           if(Memory.empire.memoryVersion !== this.memoryVersion){
            Memory.empire= {toSpawnList: {}, operations: {}, data: {}, myRooms: {}, memoryVersion: this.memoryVersion};
           }
       } else {
        Memory.empire.memoryVersion = this.memoryVersion;
       }
       this.data=Memory.empire.data;
       if(this.data == null){
           this.data = {};
       }
       this.memory=Memory.empire;

    }

    public build(): void {
        // TODO
    }

    public run(): void{
        this.spawnMgr.run();
        this.creepMgr.run();
        this.opMgr.run();
        this.stats.run();
    }

    public canColonize(): boolean {
        if(this.getBaseOps().length + this.getColonizeOps().length < Game.gcl.level && this.getBaseOps().length *2 + this.getColonizeOps.length *3 < Game.cpu.limit){
            return true;
        }
        return false;
    }

    public getColonizeOps(): ColonizeOperation[] {
        return this.opMgr.getOperationsOfType<ColonizeOperation>(OPERATION.COLONIZE);
    }


    public getBaseOps(): IInitialRoomOperation[] {
        let out = new Array<IInitialRoomOperation>();
        if(this.baseOps != null){
            return this.baseOps;
        } else {
            this.memory.myRooms = {};
            // Fill Array With first Rooms index: RoomName: roomOp
            out = this.opMgr.getBaseOperations();
            if(out.length > 0){
                for(const c of out){
                    this.memory.myRooms[c.room.name] =c.name;
                }
            } else {
                // No Initial Room Operations, and no myRooms so far => Respawned OR Memory Lost ?
                this.createInitialRoomOperations();
            }
        }
        return out;
    }

    private getBaseOpsFromMyRoomMemory(): InitialRoomOperation[] {
        const out = new Array<InitialRoomOperation>();
        if(Object.keys(this.memory.myRooms).length > 0){
            for(const roomName of Object.keys(this.memory.myRooms)){
                const op =this.opMgr.getEntryByName<InitialRoomOperation>(this.memory.myRooms[roomName]);
                if(op != null){
                    out.push(op);
                }
            }
        } else {
            console.log("WTF, No BaseOperations Found in Memory, but myRooms is Initalized");
        }
        return out;
    }
    private validateMyRooms(): void{
        if(this.memory.myRooms != null){
            for(const e of Object.keys(this.memory.myRooms)){
                const room = Game.rooms[e];
                if(room != null){
                    if(room.controller != null){
                        if(room.controller.my === false){
                            delete this.memory.myRooms[e];
                        }
                    }
                }
            }
        }
    }

    public getMyRooms(): string[] {
        const out = new Array<string>();
        const baseOps = this.getBaseOps();
        for(const op of baseOps){
            out.push(op.room.name);
        }
        return out;
    }

    private createInitialRoomOperations(): void {
        console.log("Create Initial RoomOperations");
        const myRooms= new Array<Room>();
        for(const name of Object.keys(Game.rooms)){
            const room = Game.rooms[name];
            if(room.controller != null){
                if(room.controller.my){
                    myRooms.push(room);
                }
            }
        }
        if(this.memory.myRooms == null){
            this.memory.myRooms = {};
        }
        for(const e of myRooms){
            // TODO: Check if ROom has Colonize Operation
            const opName = this.opMgr.enque({type: OPERATION.BASE, data: {roomName: e.name},pause: 1});
            this.memory.myRooms[e.name] = opName;
        }
    }

    private checkFlagListenerOperation(): void {
            if(this.data.flaglistener == null){
                this.createFlaglistenerOperation();
            } else {
                if( !this.opMgr.entryExists(this.data.flaglistener)){
                    this.data.flaglistener = null;
                }
            }
    }

    private checkGlobalOperations(): void {
        if(this.data == null){
            this.data ={};
        }
        this.checkFlagListenerOperation();
        this.checkScoutingManagerOperation();
        this.checkTradingOperation();
    }

    private createFlaglistenerOperation(): void {
        const ops = this.opMgr.getOperationsOfType(OPERATION.FLAGLISTENER);
        if(ops.length > 0 ){
            if(ops.length === 1){
                this.data.flaglistener = ops[0].name;
            } else {
                for(const o of ops){
                    this.opMgr.dequeue(o.name);
                }
                this.data.flaglistener = this.opMgr.enque({type: OPERATION.FLAGLISTENER, data: {},pause: 1});
            }
        } else {
            this.data.flaglistener = this.opMgr.enque({type: OPERATION.FLAGLISTENER, data: {},pause: 1});
        }
        
    }

    private checkScoutingManagerOperation(): void {
        if(this.data.scoutingManager == null){
            this.createScoutingManagerOperation();
        } else {
            if( !this.opMgr.entryExists(this.data.scoutingManager)){
                this.data.scoutingManager = null;
            }
        }
}

    private createScoutingManagerOperation(): void {
        const ops = this.opMgr.getOperationsOfType(OPERATION.SCOUTINGMANAGER);
        if(ops.length > 0 ){
            if(ops.length === 1){
                this.data.scoutingManager = ops[0].name;
            } else {
                for(const o of ops){
                    this.opMgr.dequeue(o.name);
                }
                this.data.scoutingManager = this.opMgr.enque({type: OPERATION.SCOUTINGMANAGER, data: {},pause: 1});
            }
        } else {
            this.data.scoutingManager = this.opMgr.enque({type: OPERATION.SCOUTINGMANAGER, data: {},pause: 1});
        }
    }

    private checkTradingOperation(): void {
        if(this.data.tradingOperation == null){
            this.createTradingOperation();
        } else {
            if( !this.opMgr.entryExists(this.data.tradingOperation)){
                this.data.tradingOperation = null;
            }
        }
    }

    private createTradingOperation(): void {
        this.data.tradingOperation = this.opMgr.enque({type: OPERATION.TRADING, data: {},pause: 1});
    }
    
    



    public init(): void {
        this.stats.init();
        this.spawnMgr.init();
        this.opMgr.init();
        this.checkGlobalOperations();
        if(Math.random() < 0.1){
            this.validateMyRooms();
        }
        
    }

    public destroy(): void {
        this.spawnMgr.destroy();
        this.opMgr.destroy();
        this.stats.destroy();
    }
}
