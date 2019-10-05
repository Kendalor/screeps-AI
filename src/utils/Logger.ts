export class Logger {
    public logLevel: {[lvl: string]: number }= {"ERROR": 0,"INFO": 1, "WARN": 2, "DEBUG": 3};
    public level: string;
    constructor(s: string) {
        this.level=s;
    }

    public info(s: string): void {
        if(this.logLevel.INFO <= this.logLevel[this.level]){
            console.log(s);
        }
    }

    public error(s: string): void {
        if(this.logLevel.ERROR <= this.logLevel[this.level]){
            console.log(s);
        }
    }

    public warn(s: string): void {
        if(this.logLevel.WARN <= this.logLevel[this.level]){
            console.log(s);
        }
    }

    public debug(s: string): void {
        if(this.logLevel.DEBUG <= this.logLevel[this.level]){
            console.log(s);
        }
    }
}