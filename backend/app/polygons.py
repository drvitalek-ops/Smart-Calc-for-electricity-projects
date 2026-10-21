"""Validation for room outlines, including concave and collinear wall segments."""
EPSILON = 1e-10


def cross(a,b,c):
    return (b['x']-a['x'])*(c['y']-a['y'])-(b['y']-a['y'])*(c['x']-a['x'])


def on_segment(a,b,p):
    return (abs(cross(a,b,p))<=EPSILON and
            min(a['x'],b['x'])-EPSILON<=p['x']<=max(a['x'],b['x'])+EPSILON and
            min(a['y'],b['y'])-EPSILON<=p['y']<=max(a['y'],b['y'])+EPSILON)


def intersects(a,b,c,d):
    ab_c,ab_d,cd_a,cd_b=cross(a,b,c),cross(a,b,d),cross(c,d,a),cross(c,d,b)
    if ((ab_c>EPSILON and ab_d<-EPSILON or ab_c<-EPSILON and ab_d>EPSILON) and
        (cd_a>EPSILON and cd_b<-EPSILON or cd_a<-EPSILON and cd_b>EPSILON)):
        return True
    return any((on_segment(a,b,c),on_segment(a,b,d),on_segment(c,d,a),on_segment(c,d,b)))


def polygon_error(points):
    if not 3<=len(points)<=1000:
        return 'Для контура нужны от 3 до 1000 вершин'
    if len({(point['x'],point['y']) for point in points})!=len(points):
        return 'Вершины контура не должны повторяться'
    area=sum(a['x']*b['y']-b['x']*a['y'] for a,b in zip(points,points[1:]+points[:1]))
    if abs(area)<=EPSILON:
        return 'Контур должен иметь ненулевую площадь'
    for index,a in enumerate(points):
        b=points[(index+1)%len(points)]
        # Adjacent collinear points may follow a wall, but cannot double back.
        previous=points[index-1]
        if on_segment(previous,a,b) or on_segment(a,b,previous):
            return 'Рёбра контура накладываются друг на друга'
        for other in range(index+1,len(points)):
            if other==index+1 or index==0 and other==len(points)-1:
                continue
            if intersects(a,b,points[other],points[(other+1)%len(points)]):
                return 'Контур помещения пересекает сам себя'
    return None
