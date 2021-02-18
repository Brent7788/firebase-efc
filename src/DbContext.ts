import firebase from "firebase/app";
import "firebase/firestore";
import DbFirestore from "./DbFirestore";
import DecoratorTool from "./tools/DecoratorTool";

export default class DbContext {

    private db = firebase.firestore();
    private batch = this.db.batch();
    private dbSetFieldNames = DecoratorTool.getMyPropertyDecoratorValues(this.constructor, "DbSet");
    private fetchTimeOut = 3000;
    private check: any;

    constructor() {
    }

    protected initializeDbFireStore(types: (new () => any)[]): void {
        if (types) {
            for (const type of types) {
                let entity = new type();
                console.log("Inter", entity.constructor.name);
                for (let dbSetName of this.dbSetFieldNames) {
                    if (entity.constructor.name === this.capitalizeFirstLetter(dbSetName)) {
                        (<any>this)[dbSetName] = new DbFirestore(type, entity, this.db, this.batch);
                    }
                    console.log(this.capitalizeFirstLetter(dbSetName));
                }
            }
        }
    }

    private capitalizeFirstLetter(str: any): string {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    public async saveChangesAsync() {
        let test = 0;
        return new Promise<void>((resolve, reject) => {
            try {
                const dbSets = this.getDbSets().filter(dbSet => dbSet);

                if (dbSets.length === 0)
                    reject("There is no entities to save");

                setTimeout(() => {
                    clearInterval(this.check);
                }, this.fetchTimeOut);

                let alreadyCommitted = false;
                //TODO This mite not be a good idea
                this.check = setInterval(async () =>  {
                    try {
                        test++;

                        const stillRun = dbSets.filter(dbSet => dbSet.isInConcurrently);

                        console.log("hello" , stillRun.length, test);
                        if (stillRun.length === 0) {
                            const writeErrors = dbSets.filter(dbSet => dbSet.writeError)
                            if (writeErrors.length === 0 && !alreadyCommitted) {
                                alreadyCommitted = true;
                                await this.batch.commit()
                            }
                            clearInterval(this.check);
                        }
                    } catch (error) {
                        clearInterval(this.check);
                        reject(`Unable to save changes, ${error}`);
                    }
                });
            } catch (error) {
                reject(`Unable to save changes, ${error}`)
            }
        });
    }

    private getDbSets(): DbFirestore<any>[] {
        return this.dbSetFieldNames.map(dbSetFieldName => <DbFirestore<any>>(<any>this)[dbSetFieldName]);
    }
}