import { CreepManager } from "empire/CreepManager";
import { EmpireStats } from "./EmpireStats";
import { InitialRoomOperation } from "./operations/Operations/InitialBuildUpPhase/InitRoomOperation";
import { OperationsManager } from "./OperationsManager";
import { SpawnManager } from "./SpawnManager";


export class EmpireManager  {
    public opMgr: OperationsManager;
    public creepMgr: CreepManager;
    public spawnMgr: SpawnManager;
    public stats: EmpireStats;
    public data: any;
    public memory: EmpireMemory;
    private baseOps: InitialRoomOperation[] | undefined;


    constructor(){
        if(Memory.empire == null){
            Memory.empire= {toSpawnList: {}, operations: {}, data: {}, myRooms: {}} ;
        }
        if(Memory.empire.data == null){
            Memory.empire.data ={};
        }
        this.stats = new EmpireStats(this);
       this.opMgr = new OperationsManager(this);
       this.creepMgr = new CreepManager(this);
       this.spawnMgr = new SpawnManager(this);
       this.data=Memory.empire.data;
       this.memory=Memory.empire;

    }
    public getBaseOps(): InitialRoomOperation[] {
        let out = new Array<InitialRoomOperation>();
        if(this.baseOps != null){
            return this.baseOps;
        } else {
            if(this.memory.myRooms == null){
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
            } else {
                // Class Object not set but List in memory.myRooms exists
                out = this.getBaseOpsFromMyRoomMemory();
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
        for(const name of Object.keys(Game.rooms)){
            const room = Game.rooms[name];
            if(room.controller != null){
                if(room.controller.my){
                    const opName = this.opMgr.enque({type: "InitialRoomOperation", data: {roomName: name}, priority: 100,pause: 1});
                    this.memory.myRooms[name] = opName;
                }
            }
        }
    }

    private checkFlagListenerOperation(): void {
            if(this.data.flaglistener == null){
                this.createFlaglistenerOperation();
                if( !this.opMgr.entryExists(this.data.flaglistener)){
                    this.data.flaglistener = null;
                }
            }
    }

    private checkGlobalOperations(): void {
        if(this.memory.data == null){
            this.memory.data ={};
        }
        this.checkFlagListenerOperation();
        this.checkScoutingManagerOperation();
    }

    private createFlaglistenerOperation(): void {
        this.data.flaglistener = this.opMgr.enque({type: "FlagListener", data: {}, priority: 90,pause: 1});
    }

    private checkScoutingManagerOperation(): void {
        if(this.data.scoutingManager == null){
            this.createScoutingManagerOperation();
            if( !this.opMgr.entryExists(this.data.scoutingManager)){
                this.data.scoutingManager = null;
            }
        }
}

    private createScoutingManagerOperation(): void {
        this.data.scoutingManager = this.opMgr.enque({type: "OperationScoutingManager", data: {}, priority: 30,pause: 1});
    }
    
    public run(): void{
        global.logger.debug("Empire Manager doing Stuff ");
        let time = Game.cpu.getUsed();
        this.spawnMgr.run();
        global.logger.info(" ----------------- SPAWNMANAGER CPU USED ----------------- " + (Game.cpu.getUsed() - time) + " ----------------- ");
        time = Game.cpu.getUsed();
        this.creepMgr.run();
        global.logger.info(" ----------------- CREEPMANAGER CPU USED ----------------- " + (Game.cpu.getUsed() - time) + " ----------------- ");
        time = Game.cpu.getUsed();
        this.opMgr.run();
        global.logger.info(" ----------------- OP   MANAGER CPU USED ----------------- " + (Game.cpu.getUsed() - time) + " ----------------- ");
        this.stats.run();
        
    }


    public init(): void {
        this.stats.init();
        let time = Game.cpu.getUsed();
        this.spawnMgr.init();
        global.logger.info(" INIT ----------- SPAWNMANAGER CPU USED ----------------- " + (Game.cpu.getUsed() - time) + " ----------------- ");
        time = Game.cpu.getUsed();
        this.opMgr.init();
        global.logger.info(" INIT ----------- OP  MANAGER CPU USED ----------------- " + (Game.cpu.getUsed() - time) + " ----------------- ");
        time = Game.cpu.getUsed();
        this.checkGlobalOperations();
    }

    public destroy(): void {
        let time = Game.cpu.getUsed();
        this.spawnMgr.destroy();
        global.logger.info(" DESTROY ------- SPAWNMANAGER CPU USED ----------------- " + (Game.cpu.getUsed() - time) + " ----------------- ");
        time = Game.cpu.getUsed();
        this.opMgr.destroy();
        global.logger.info(" DESTORY  ------ OP   MANAGER CPU USED ----------------- " + (Game.cpu.getUsed() - time) + " ----------------- ");
        time = Game.cpu.getUsed();
        this.stats.destroy();
    }
}
