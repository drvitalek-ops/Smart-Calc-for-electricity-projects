import {Component,type ReactNode} from 'react';
export default class AppErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<main style={{padding:32}} role="alert"><h1>Не удалось отобразить приложение</h1><p>Перезапустите окно приложения. Сохранённые данные остаются в хранилище.</p><button onClick={()=>window.location.reload()}>Перезапустить окно</button></main>:this.props.children;}
}
