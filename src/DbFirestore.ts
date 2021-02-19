import firebase from "firebase/app";
import "firebase/firestore";
import AbstractEntity from "./entities/AbstractEntity";
import {ConditionState, Expresion, ExpresionBuilder} from "./tools/ExpresionBuilder";
import CollectionReference = firebase.firestore.CollectionReference;
import DocumentData = firebase.firestore.DocumentData;
import WhereFilterOp = firebase.firestore.WhereFilterOp;
import Query = firebase.firestore.Query;
import Firestore = firebase.firestore.Firestore;
import WriteBatch = firebase.firestore.WriteBatch;
import Condition from "./tools/Condition";
import ObservableEntity from "./tools/ObservableEntity";

export default class DbFirestore<T extends AbstractEntity> {

    private db: Firestore;
    private readonly batch: WriteBatch;
    private entity: T;
    private readonly type: (new () => T);
    private readonly entityName: string;
    private readonly collectionRef: CollectionReference<DocumentData>;
    private queries: Query<DocumentData>[] = [];

    public writeError = false;
    public isRunConcurrently = false;
    public observableEntities: ObservableEntity<T>[] = [];

    constructor(type: (new () => T), entity: T, db: Firestore, batch: WriteBatch) {
        this.type = type;
        this.entity = entity;
        this.entityName = entity.constructor.name;
        this.db = db;
        this.batch = batch;
        this.collectionRef = this.db.collection(this.entityName);
    }

    public where(expresion: (entity: T) => ExpresionBuilder): DbFirestore<T> {
        this.isRunConcurrently = true;
        this.setQueries(expresion(this.entity).prosesExpresionSet());
        return this;
    }

    public async firstOrDefaultAsync(expresion: (entity: T) => ExpresionBuilder): Promise<T | undefined> {
        this.isRunConcurrently = true;
        const exp: ExpresionBuilder = expresion(this.entity).prosesExpresionSet();

        if (exp.conditionState === ConditionState.START &&
            exp.orExpressions.length === 1 &&
            Condition.stringContain(exp.orExpressions[0].field, "id")) {

            const documentReference = this.collectionRef.doc(exp.orExpressions[0].value);
            const documentSnapshot = await documentReference.get();

            if (!documentSnapshot.exists) {
                return undefined;
            } else {
                return Object.assign(new this.type(), documentSnapshot.data());
            }
        } else {
            this.setQueries(exp);
        }
        const entities = await this.toListAsync();

        return (entities.length !== 0) ? entities[0] : undefined;
    }

    public async toListAsync(): Promise<T[]> {

        const entities: T[] = [];
        const querySnapshotPromises = this.queries.map(q => q.get());

        console.log(this.queries.length);

        //TODO Object.assign(new this.type(), doc.data()) only works for primitive fields in that entity
        //     objects in the entity will be undefined
        for await (const querySnapshot of querySnapshotPromises) {
            for (const doc of (await querySnapshot).docs) {
                //entities.push({...new this.type(), ...doc.data()});
                //const entity = Object.assign(new this.type(), doc.data());
                const observableEntity = new ObservableEntity<T>(Object.assign(new this.type(), doc.data()));

                entities.push(observableEntity.getObserveEntity());
                this.observableEntities.push(observableEntity);
            }
        }

        this.queries = [];
        this.isRunConcurrently = false;
        return entities;
    }

    private setQueries(exp: ExpresionBuilder): void {

        if (exp.conditionState === ConditionState.START && exp.andExpresionGroup.length === 0) {

            const expressionObj = exp.orExpressions[0];
            this.queries.push(this.collectionRef.where(expressionObj.field, <WhereFilterOp>expressionObj.operator, expressionObj.value));

        }

        if (exp.andExpresionGroup.length > 0 && this.queries.length === 0) {
            let expressions: Expresion[];
            let queryIndex = 0;
            for (const expresionGroup of exp.andExpresionGroup) {

                expressions = expresionGroup.expressions;

                for (const expressionObj of expressions) {
                    if (this.queries[queryIndex]) {
                        this.queries[queryIndex] = this.queries[queryIndex].where(expressionObj.field, <WhereFilterOp>expressionObj.operator, expressionObj.value);
                    } else {
                        this.queries[queryIndex] = this.collectionRef.where(expressionObj.field, <WhereFilterOp>expressionObj.operator, expressionObj.value);
                    }
                }
                queryIndex++;
            }
        }

        if (exp.orExpressions.length > 0) {
            for (const orExpression of exp.orExpressions) {
                this.queries.push(this.collectionRef.where(orExpression.field, <WhereFilterOp>orExpression.operator, orExpression.value));
            }
        }
    }
}