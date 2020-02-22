import { OPERATION, OperationMemory } from "utils/constants";
import { operationFactory } from "utils/operationFactory";
import { EmpireManager } from "./EmpireManager";
import { Operation } from "./operations/Operation";
import { InitialRoomOperation } from "./operations/Operations/InitialBuildUpPhase/InitRoomOperation";





export class OperationsManager {

	public empire: EmpireManager;
	public operations: {[id: string]: Operation} = {};
	public operationsTodo: Array<[string, Operation]> = new Array<[string, Operation]>();

    constructor(emp: EmpireManager) {
		this.empire=emp;
		if(Memory.empire.operations== null){
			Memory.empire.operations = {};
		}

	}
	/**
	 * Start of Tick Method
	 */

	public init(): void {
		this.loadOperationList();
	}
	/**
	 * Run Method executed per tick
	 */
    public run(): void {


		let counter =0;
		
		while( this.hasNextOperation()) {
				this.runNextOperation();

			counter = counter +1;
		}

		this.destroy();

		
	}
	/**
	 * End of Tick Method
	 */
	public destroy(): void {
		this.saveOperationList();
	}

	public getOperationsOfType<T extends Operation>(type: OPERATION): T[]{
		const out = new Array<T>();
		for(const op of Object.keys(this.operations)){
			if(this.operations[op].type === type){
				out.push(this.operations[op] as T);
			}
		}
		return out;
	}

	public getBaseOperations(): InitialRoomOperation[] {
		return this.getOperationsOfType<InitialRoomOperation>(OPERATION.BASE);
	}



	/**
	 * Run the next runable RoomOperation in the operations List with the highest Priority
	 */
    public runNextOperation(): void {
		const op = this.getNextOperation();
		if( op !== undefined ) {
			if(Game.cpu.getUsed() < Game.cpu.tickLimit *0.8) {
				const time = Game.cpu.getUsed();
				op.run();
				this.empire.stats.addOp( Game.cpu.getUsed() - time, op.type);
			} else {
				console.log("Skipped OP because empty Bucket");
			}



		}
	}

	public getNextOperation(): Operation | undefined {
		if(this.hasNextOperation()){
			const temp = this.operationsTodo.pop();
			if( temp != null ){
				return temp[1];
			} else {
				return undefined;
			}
		} else {
			return undefined;
		}
	}
	public hasNextOperation(): boolean {
		return this.operationsTodo.length > 0;
	}

	/**
 	* Load Operations from Memory
	 */
    public loadOperationList(): void {
		
		this.operations = {};
		if(Memory.empire.operations == null){
			Memory.empire.operations = {};
		}
        for(const i of Object.keys(Memory.empire.operations)) {
			const op = operationFactory(Memory.empire.operations[i].type);
			if(op !== undefined){
				try {
					this.operations[i]= new op(i, this, Memory.empire.operations[i] as OperationMemory);
				} catch (error) {
					console.log("Error for Operation: " + i + "of type: " + this.operations[i].type + " with Error: " +error);
				}
			} else {
				console.log("INVALID OPERATION WITH TYPE: " +Memory.empire.operations[i].type + " DELETED" );
				delete Memory.empire.operations[i];
			}
            
		}

		this.operationsTodo = Object.entries(this.operations).filter( entry => entry[1].pause === 0 && entry[1].didRun === false).sort( (entryA,entryB) => entryA[1].priority - entryB[1].priority);
    }
    /**
     * Save Operations to Memory
     */
    public saveOperationList(): void {
		Memory.empire.operations = {};
		global.logger.debug("Saving Operations List of Lengh: " + Object.keys(this.operations).length);
        for(const key of Object.keys(this.operations)) {
			if(this.operations[key].pause > 0){
				this.operations[key].pause = this.operations[key].pause -1;
			}
			Memory.empire.operations[key] = this.operations[key].toMemory() as OperationMemory;
		}
		global.logger.debug("Saved Operations: " + Object.keys(Memory.empire.operations).length);
	}

	public generateName(): string {
        return Math.random().toString(36).substr(8);
    }


    /**
     * push a new RoomOperation into the operations List of the RoomManager
     * @param entry RoomOperation
     */
    public enque(entry: OperationMemory){
		const name = this.generateName();
		const op = operationFactory(entry.type);
		if( op !== undefined){
			this.operations[name]=new op(name, this, entry as OperationMemory);
			global.logger.debug(" ADDED Operation: " + name + " of Type: " + entry.type + " data: " + entry.data);		}
		return name;
	}
	
    /**
     * remove a new RoomOperation from the operations List of the RoomManager
     * @param entry RoomOperationMemoryInterface
     */

	public entryExists(name: string ){
		return this.operations[name] != null;
	}

	public getEntryByName<T extends Operation>(name: string): T | null {
		if(this.entryExists(name)){
			return this.operations[name] as T;
		} else {
			return null;
		}
	}

    public dequeue(name: string){
       delete this.operations[name];
    }
}